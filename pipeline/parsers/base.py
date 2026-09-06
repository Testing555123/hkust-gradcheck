"""解析后端统一接口：所有 parser 输出同一 ParsedDocument 结构。

管线消费方（llm_extract / crosscheck）只依赖本模块的数据类，
不感知底层是 MinerU 在线 API、MinerU 本地还是 pymupdf。
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class PageBlock:
    """带页码来源的内容块（LLM 引用与差异报告的出处单位）。"""

    page: int  # 1-based 页码
    type: str  # text / table / image / equation
    text: str
    table_rows: list[list[str]] = field(default_factory=list)


@dataclass
class ParsedDocument:
    source_path: str
    parser_name: str
    pages: dict[int, str] = field(default_factory=dict)  # 页码 -> 该页纯文本
    blocks: list[PageBlock] = field(default_factory=list)
    markdown: str = ""  # 全文 Markdown，页与页之间带页码标注

    @property
    def page_count(self) -> int:
        return len(self.pages)

    def text_with_page_markers(self) -> str:
        """供 LLM 使用的全文：每页前插入页码标记，便于模型引用出处。"""
        parts = [f"===== [PAGE {page}] =====\n{self.pages.get(page, '').strip()}" for page in sorted(self.pages)]
        return "\n\n".join(parts)


def load_document(json_path: Path) -> Optional[ParsedDocument]:
    """从缓存 JSON 载入已解析文档（断点续跑用）。"""
    import json

    if not json_path.exists():
        return None
    data = json.loads(json_path.read_text(encoding="utf-8"))
    blocks = [PageBlock(**b) for b in data.get("blocks", [])]
    return ParsedDocument(
        source_path=data["source_path"],
        parser_name=data["parser_name"],
        pages={int(k): v for k, v in data["pages"].items()},
        blocks=blocks,
        markdown=data.get("markdown", ""),
    )


def save_document(doc: ParsedDocument, json_path: Path) -> None:
    """解析结果落盘缓存，断点续跑时直接复用，不再重复调用 MinerU。"""
    import json

    json_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source_path": doc.source_path,
        "parser_name": doc.parser_name,
        "pages": {str(k): v for k, v in doc.pages.items()},
        "blocks": [
            {"page": b.page, "type": b.type, "text": b.text, "table_rows": b.table_rows}
            for b in doc.blocks
        ],
        "markdown": doc.markdown,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

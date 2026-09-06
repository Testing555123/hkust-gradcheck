"""MinerU 本地 CPU 回退后端（可选）。

通过 subprocess 调用 mineru CLI，避免与主 venv 的 Python 版本耦合
（MinerU 官方要求 Python 3.10 独立环境）。

准备本地环境（一次性）：
    conda create -n mineru python=3.10
    conda activate mineru
    pip install "mineru[cpu]"
    # 首次运行会自动下载模型（GB 级），需要 16GB+ 内存

环境变量：
    MINERU_CLI_PATH  mineru 可执行文件路径（如 conda 环境中的 mineru.exe）
"""

import json
import os
import subprocess
from pathlib import Path

from .base import PageBlock, ParsedDocument


def _find_cli() -> str:
    cli = os.environ.get("MINERU_CLI_PATH", "mineru")
    return cli


def _map_content_list(content_list: list[dict], pdf_path: str, markdown: str) -> ParsedDocument:
    pages: dict[int, str] = {}
    blocks: list[PageBlock] = []
    for item in content_list:
        page_no = int(item.get("page_idx", 0)) + 1
        item_type = item.get("type", "text")
        text = item.get("text") or ""
        table_rows: list[list[str]] = []
        if item_type == "table":
            body = (item.get("table_body") or "").strip()
            if body:
                rows = [
                    [c.strip() for c in row.strip(" |").split("|")]
                    for row in body.splitlines()
                    if row.strip() and set(row.strip()) - {"|", "-", " "}
                ]
                table_rows = rows
                text = "\n".join(" | ".join(r) for r in rows)
        if not text:
            continue
        pages[page_no] = (pages.get(page_no, "") + "\n" + text).strip()
        blocks.append(PageBlock(page=page_no, type=item_type, text=text, table_rows=table_rows))

    return ParsedDocument(
        source_path=pdf_path,
        parser_name="mineru_local",
        pages=pages,
        blocks=blocks,
        markdown=markdown,
    )


def parse_pdf(pdf_path: str) -> ParsedDocument:
    pdf = Path(pdf_path)
    out_dir = pdf.parent / "_mineru_out"
    out_dir.mkdir(exist_ok=True)

    cmd = [_find_cli(), "-p", str(pdf), "-o", str(out_dir)]
    print(f"[mineru_local] run: {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(f"mineru CLI 失败:\n{proc.stdout[-500:]}\n{proc.stderr[-500:]}")

    md_files = list(out_dir.rglob("*.md"))
    cl_files = list(out_dir.rglob("*_content_list.json"))
    if not cl_files:
        raise FileNotFoundError(f"mineru 输出中未找到 *_content_list.json: {out_dir}")

    markdown = md_files[0].read_text(encoding="utf-8") if md_files else ""
    content_list = json.loads(cl_files[0].read_text(encoding="utf-8"))
    return _map_content_list(content_list, str(pdf), markdown)

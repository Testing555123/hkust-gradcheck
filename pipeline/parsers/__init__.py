"""可插拔 PDF 解析后端。

用法：
    from pipeline.parsers import get_parser
    doc = get_parser("mineru_api")(pdf_path)   # 默认
    doc = get_parser("pymupdf")(pdf_path)      # 降级
"""

from pathlib import Path

from .base import PageBlock, ParsedDocument, load_document, save_document
from . import mineru_api, mineru_local, pymupdf_backend

BACKENDS = {
    "mineru_api": mineru_api.parse_pdf,
    "mineru_local": mineru_local.parse_pdf,
    "pymupdf": pymupdf_backend.parse_pdf,
}


def get_parser(name: str):
    if name not in BACKENDS:
        raise ValueError(f"未知 parser: {name}，可选 {list(BACKENDS)}")
    return BACKENDS[name]


def cache_file_for(pdf_path: str | Path, parser_name: str, cache_dir: Path) -> Path:
    """缓存文件名：**学年 + stem + 后端**。

    学年不可省略：4 个学年的 PDF 文件名完全相同（如 MATH_BSc_in_Mathematics.pdf），
    只用 stem 会让所有学年共用一个缓存条目，后跑的学年静默拿到别的学年的课表。
    """
    pdf = Path(pdf_path)
    return cache_dir / f"{pdf.parent.name}__{pdf.stem}.{parser_name}.parsed.json"


def parse_with_cache(pdf_path: str, parser_name: str, cache_dir: Path) -> ParsedDocument:
    """带缓存的解析入口：同源文件同后端只解析一次（断点续跑基础）。"""
    pdf = Path(pdf_path)
    cache_file = cache_file_for(pdf, parser_name, cache_dir)
    cached = load_document(cache_file)
    # 二次防御：缓存记录的实际源路径与本次不一致时视为未命中
    if cached is not None and cached.source_path == str(pdf):
        print(f"[cache] hit: {cache_file.name}")
        return cached
    if cached is not None:
        print(f"[cache] stale: {cache_file.name} 源路径不符，重新解析")
    doc = get_parser(parser_name)(str(pdf))
    save_document(doc, cache_file)
    return doc


__all__ = [
    "PageBlock",
    "ParsedDocument",
    "load_document",
    "save_document",
    "get_parser",
    "parse_with_cache",
    "cache_file_for",
    "BACKENDS",
]

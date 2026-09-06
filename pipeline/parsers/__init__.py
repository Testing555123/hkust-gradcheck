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


def parse_with_cache(pdf_path: str, parser_name: str, cache_dir: Path) -> ParsedDocument:
    """带缓存的解析入口：同源文件同后端只解析一次（断点续跑基础）。"""
    pdf = Path(pdf_path)
    cache_file = cache_dir / f"{pdf.stem}.{parser_name}.parsed.json"
    cached = load_document(cache_file)
    if cached is not None:
        print(f"[cache] hit: {cache_file.name}")
        return cached
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
    "BACKENDS",
]

"""解析缓存键必须按学年隔离（43/44 个专业的 PDF 文件名跨学年完全相同）。"""

from pathlib import Path

from parsers import cache_file_for


def test_cache_key_includes_year():
    a = cache_file_for("unpress_pdf/major/2023-24/MATH_BSc_in_Mathematics.pdf", "mineru_api", Path("cache"))
    b = cache_file_for("unpress_pdf/major/2024-25/MATH_BSc_in_Mathematics.pdf", "mineru_api", Path("cache"))
    assert a != b
    assert a.name.startswith("2023-24__")
    assert b.name.startswith("2024-25__")


def test_cache_key_separates_parser_backend():
    a = cache_file_for("x/2025-26/COMP_x.pdf", "mineru_api", Path("cache"))
    b = cache_file_for("x/2025-26/COMP_x.pdf", "pymupdf", Path("cache"))
    assert a != b

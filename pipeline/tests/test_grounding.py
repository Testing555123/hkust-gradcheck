"""grounding 单测：字符区间 -> 页码 -> chunk_id 的映射与稳定性。

这是双 pass 溯源链上唯一必须自研的一层：langextract 给出 char_interval，
ParsedDocument 只按页组织文本，两者之间需要一个可复现的映射。
"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from grounding import build_chunks, chunk_id_for, locate  # noqa: E402
from parsers.base import ParsedDocument  # noqa: E402


def _doc() -> ParsedDocument:
    return ParsedDocument(
        source_path="x.pdf",
        parser_name="pymupdf",
        pages={1: "Alpha one.\nAlpha two.", 2: "Beta one.", 3: "Gamma one."},
    )


def test_chunk_ids_are_stable_for_same_input() -> None:
    a = build_chunks(_doc(), "2026-27/COMP")
    b = build_chunks(_doc(), "2026-27/COMP")
    assert [c.chunk_id for c in a] == [c.chunk_id for c in b]


def test_chunk_ids_differ_for_different_program() -> None:
    a = build_chunks(_doc(), "2026-27/COMP")
    b = build_chunks(_doc(), "2026-27/MATH")
    assert [c.chunk_id for c in a] != [c.chunk_id for c in b]


def test_chunk_id_is_short_hex() -> None:
    cid = chunk_id_for("2026-27/COMP", 1, 0, "Alpha one.")
    assert len(cid) == 16
    int(cid, 16)  # 必须是可解析的十六进制


def test_chunks_cover_every_page() -> None:
    chunks = build_chunks(_doc(), "2026-27/COMP")
    assert {c.page for c in chunks} == {1, 2, 3}


def test_char_offsets_index_into_marked_text() -> None:
    """切片区间必须能原样切回原文，否则溯源是假的。"""
    doc = _doc()
    full = doc.text_with_page_markers()
    for c in build_chunks(doc, "2026-27/COMP"):
        assert full[c.char_start : c.char_end] == c.text


def test_offsets_increase_across_pages() -> None:
    doc = _doc()
    chunks = build_chunks(doc, "2026-27/COMP")
    p1 = max(c.char_end for c in chunks if c.page == 1)
    p2 = min(c.char_start for c in chunks if c.page == 2)
    assert p1 <= p2


def test_locate_returns_the_chunk_containing_interval() -> None:
    chunks = build_chunks(_doc(), "2026-27/COMP")
    target = chunks[1]
    found = locate(chunks, target.char_start, target.char_end)
    assert found is not None
    assert found.chunk_id == target.chunk_id
    assert found.page == target.page


def test_locate_returns_none_when_interval_out_of_range() -> None:
    chunks = build_chunks(_doc(), "2026-27/COMP")
    assert locate(chunks, 10**9, 10**9 + 5) is None


def test_locate_returns_none_for_empty_chunks() -> None:
    assert locate([], 0, 10) is None

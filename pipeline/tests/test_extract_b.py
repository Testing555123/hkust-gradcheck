"""extract_b 单测：langextract 第二 pass 的产物装配、溯源与防幻觉闸门。

用假的 extract_fn 注入，不调真实 LLM、不依赖网络。
"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

import pytest  # noqa: E402
from langextract import data as lxdata  # noqa: E402
from langextract import schema as lxschema  # noqa: E402

from extract_b import PassBResult, build_output_schema, run_pass_b  # noqa: E402
from parsers.base import ParsedDocument  # noqa: E402

GROUP_ATTRS = {
    "kind": "group",
    "group_name": "Required Courses",
    "required_credits": 30,
    "required_credits_raw": "30",
    "note": "",
    "code": "",
    "name": "",
    "credits": 0,
    "credits_raw": "",
    "areas": [],
}


def _course_attrs(code: str, name: str, credits: float) -> dict:
    return {
        "kind": "course",
        "group_name": "Required Courses",
        "required_credits": 30,
        "required_credits_raw": "30",
        "note": "",
        "code": code,
        "name": name,
        "credits": credits,
        "credits_raw": str(credits),
        "areas": [],
    }


def _extraction(attrs: dict, start: int | None, end: int | None) -> lxdata.Extraction:
    return lxdata.Extraction(
        extraction_class="requirement",
        extraction_text="raw span",
        attributes=attrs,
        char_interval=(
            None if start is None else lxdata.CharInterval(start_pos=start, end_pos=end)
        ),
        alignment_status=lxdata.AlignmentStatus.MATCH_EXACT,
    )


def _doc() -> ParsedDocument:
    return ParsedDocument(
        source_path="COMP.pdf",
        parser_name="pymupdf",
        pages={1: "Required Courses 30\nCOMP 1023 Intro 3\nCOMP 1024 Data 3"},
    )


def _annotated(extractions: list) -> lxdata.AnnotatedDocument:
    return lxdata.AnnotatedDocument(extractions=extractions, text=_doc().text_with_page_markers())


def test_output_schema_passes_langextract_validation() -> None:
    lxschema.validate_output_schema(build_output_schema())


def test_assembles_group_then_courses_in_appearance_order() -> None:
    doc = _doc()
    ann = _annotated(
        [
            _extraction(GROUP_ATTRS, 0, 10),
            _extraction(_course_attrs("COMP1023", "Intro", 3.0), 20, 30),
            _extraction(_course_attrs("COMP1024", "Data", 3.0), 31, 40),
        ]
    )
    out = run_pass_b(doc, "2026-27", "COMP", "2026-27/COMP", extract_fn=lambda **kw: ann)

    assert isinstance(out, PassBResult)
    assert len(out.result.groups) == 1
    group = out.result.groups[0]
    assert group.name == "Required Courses"
    assert group.required_credits == 30
    assert [c.code for c in group.courses] == ["COMP1023", "COMP1024"]


def test_second_group_starts_a_new_group() -> None:
    doc = _doc()
    elective = dict(GROUP_ATTRS, group_name="Electives", required_credits=12)
    ann = _annotated(
        [
            _extraction(GROUP_ATTRS, 0, 10),
            _extraction(_course_attrs("COMP1023", "Intro", 3.0), 20, 30),
            _extraction(elective, 40, 50),
            _extraction(_course_attrs("COMP2011", "DS", 3.0), 51, 60),
        ]
    )
    out = run_pass_b(doc, "2026-27", "COMP", "2026-27/COMP", extract_fn=lambda **kw: ann)

    assert [g.name for g in out.result.groups] == ["Required Courses", "Electives"]
    assert [c.code for c in out.result.groups[1].courses] == ["COMP2011"]


def test_extraction_without_char_interval_is_dropped_and_counted() -> None:
    """char_interval=None 表示模型编的、原文里找不到 —— 必须丢弃并计入 degraded。"""
    doc = _doc()
    ann = _annotated(
        [
            _extraction(GROUP_ATTRS, 0, 10),
            _extraction(_course_attrs("COMP1023", "Intro", 3.0), 20, 30),
            _extraction(_course_attrs("COMP9999", "Hallucinated", 3.0), None, None),
        ]
    )
    out = run_pass_b(doc, "2026-27", "COMP", "2026-27/COMP", extract_fn=lambda **kw: ann)

    assert [c.code for c in out.result.groups[0].courses] == ["COMP1023"]
    assert out.degraded == 1


def test_evidence_is_keyed_by_path_and_resolves_to_chunk() -> None:
    doc = _doc()
    ann = _annotated(
        [
            _extraction(GROUP_ATTRS, 0, 10),
            _extraction(_course_attrs("COMP1023", "Intro", 3.0), 20, 30),
        ]
    )
    out = run_pass_b(doc, "2026-27", "COMP", "2026-27/COMP", extract_fn=lambda **kw: ann)

    ev = out.evidence["groups[0].courses[0]"]
    assert ev.page == 1
    assert ev.chunk_id
    assert doc.text_with_page_markers()[ev.char_start : ev.char_end]


def test_course_before_any_group_is_kept_under_implicit_group() -> None:
    doc = _doc()
    ann = _annotated([_extraction(_course_attrs("COMP1023", "Intro", 3.0), 20, 30)])
    out = run_pass_b(doc, "2026-27", "COMP", "2026-27/COMP", extract_fn=lambda **kw: ann)

    assert len(out.result.groups) == 1
    assert out.result.groups[0].courses[0].code == "COMP1023"


def test_missing_api_key_raises_instead_of_silent_empty() -> None:
    import os

    from extract_b import run_pass_b as _run

    saved = os.environ.pop("GRAD_LLM_API_KEY", None)
    try:
        with pytest.raises(RuntimeError):
            _run(_doc(), "2026-27", "COMP", "2026-27/COMP")
    finally:
        if saved is not None:
            os.environ["GRAD_LLM_API_KEY"] = saved

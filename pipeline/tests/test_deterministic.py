"""deterministic 单测：不依赖 LLM 的事实性校验。

这些判定必须是纯函数——同样的输入永远得到同样的结论，
否则「两 pass 分歧」就无法用它们来压降。
"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from agents.deterministic import (  # noqa: E402
    check_source_pdf,
    run_all,
    validate_course_code,
)
from schemas import ExtractedCourse, ExtractedGroup, ExtractionResult  # noqa: E402


def _result(groups: list[ExtractedGroup]) -> ExtractionResult:
    return ExtractionResult(year="2026-27", code="COMP", title="BEng", groups=groups)


def test_valid_course_codes_accepted() -> None:
    for code in ["COMP1023", "MATH1012", "COMP1022P", "BMH1234", "CIVL2001"]:
        assert validate_course_code(code), code


def test_invalid_course_codes_rejected() -> None:
    for code in ["COMP 1023", "comp1023", "1234", "", "COMP10233", "COMP-1023"]:
        assert not validate_course_code(code), code


def test_detects_invalid_course_code() -> None:
    r = _result(
        [ExtractedGroup(name="Required", required_credits=3,
                        courses=[ExtractedCourse(code="COMP 1023", name="x", credits=3)])]
    )
    issues = run_all(r, source_pdf="unpress_pdf/major/COMP.pdf")
    assert any(i.type == "invalid_course_code" for i in issues)


def test_detects_missing_group_name() -> None:
    r = _result([ExtractedGroup(name="", required_credits=3)])
    issues = run_all(r, source_pdf=None)
    assert any(i.type == "missing_group_name" for i in issues)


def test_detects_missing_course_code() -> None:
    r = _result(
        [ExtractedGroup(name="Required", required_credits=3,
                        courses=[ExtractedCourse(code="", name="x", credits=3)])]
    )
    issues = run_all(r, source_pdf=None)
    assert any(i.type == "missing_course_code" for i in issues)


def test_credits_must_match_raw_lower_bound() -> None:
    bad = _result(
        [ExtractedGroup(name="Required", required_credits=4,
                        courses=[ExtractedCourse(code="COMP1023", name="x", credits=6,
                                                 credits_raw="4-6 Credit(s)")])]
    )
    assert any(i.type == "credits_raw_mismatch" for i in run_all(bad, source_pdf=None))

    good = _result(
        [ExtractedGroup(name="Required", required_credits=4,
                        courses=[ExtractedCourse(code="COMP1023", name="x", credits=4,
                                                 credits_raw="4-6 Credit(s)")])]
    )
    assert not any(i.type == "credits_raw_mismatch" for i in run_all(good, source_pdf=None))


def test_absolute_source_pdf_is_rejected() -> None:
    """gates.ts 会拒绝本机绝对路径入库，必须在写库前拦下来。"""
    issues = check_source_pdf("C:/Users/x/newone/unpress_pdf/major/COMP.pdf")
    assert issues and issues[0].type == "absolute_source_pdf"


def test_relative_source_pdf_is_accepted() -> None:
    assert check_source_pdf("unpress_pdf/major/2026-27/COMP.pdf") == []


def test_clean_result_has_no_issues() -> None:
    r = _result(
        [ExtractedGroup(
            name="Required",
            required_credits=3,
            courses=[ExtractedCourse(code="COMP1023", name="Intro", credits=3,
                                     credits_raw="3 Credit(s)")],
        )]
    )
    assert run_all(r, source_pdf="unpress_pdf/major/COMP.pdf") == []

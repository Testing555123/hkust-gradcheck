"""diff 单测：两 pass 结果的字段级对齐与比对。

对齐规则（决定 diff 的正确性）：
- 组按 name 对齐，不按出现顺序；
- 组内课程按 code 对齐。
"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from agents.diff import diff_results  # noqa: E402
from agents.schemas import DiffKind, Evidence  # noqa: E402
from schemas import ExtractedCourse, ExtractedGroup, ExtractionResult  # noqa: E402


def _result(groups: list[ExtractedGroup]) -> ExtractionResult:
    return ExtractionResult(year="2026-27", code="COMP", title="BEng", groups=groups)


def _group(name: str, credits: float, courses: list[tuple[str, float]]) -> ExtractedGroup:
    return ExtractedGroup(
        name=name,
        required_credits=credits,
        courses=[
            ExtractedCourse(code=c, name=f"Name {c}", credits=v) for c, v in courses
        ],
    )


def _evidence() -> Evidence:
    return Evidence(chunk_id="abc123", page=1, char_start=10, char_end=20)


def test_agree_when_both_passes_identical() -> None:
    a = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    b = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    report = diff_results(a, b, {"groups[0].courses[0]": _evidence()})

    assert report.agreed, "两 pass 完全一致时应全部 AGREE"
    assert not report.conflicts
    assert not report.missing


def test_conflict_when_credits_differ() -> None:
    a = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    b = _result([_group("Required", 30, [("COMP1023", 4.0)])])
    report = diff_results(a, b, {"groups[0].courses[0]": _evidence()})

    assert len(report.conflicts) == 1
    finding = report.conflicts[0]
    assert finding.path == "groups[0].courses[0].credits"
    assert finding.field == "credits"
    assert (finding.value_a, finding.value_b) == (3.0, 4.0)


def test_group_required_credits_is_compared() -> None:
    a = _result([_group("Required", 30, [])])
    b = _result([_group("Required", 36, [])])
    report = diff_results(a, b, {})

    assert [f.path for f in report.conflicts] == ["groups[0].required_credits"]


def test_groups_aligned_by_name_not_by_order() -> None:
    a = _result([_group("Required", 30, []), _group("Electives", 12, [])])
    b = _result([_group("Electives", 12, []), _group("Required", 30, [])])
    report = diff_results(a, b, {})

    assert not report.conflicts
    assert not report.missing


def test_course_only_in_pass_a_is_missing() -> None:
    a = _result([_group("Required", 30, [("COMP1023", 3.0), ("COMP1024", 3.0)])])
    b = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    report = diff_results(a, b, {})

    missing = [f for f in report.missing if f.field == "credits"]
    assert [f.path for f in missing] == ["groups[0].courses[1].credits"]
    assert missing[0].value_a == 3.0
    assert missing[0].value_b is None


def test_course_only_in_pass_b_is_missing() -> None:
    a = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    b = _result([_group("Required", 30, [("COMP1023", 3.0), ("COMP2011", 3.0)])])
    report = diff_results(a, b, {"groups[0].courses[1]": _evidence()})

    missing = [f for f in report.missing if f.path == "groups[0].courses[1].credits"]
    assert missing[0].value_a is None
    assert missing[0].value_b == 3.0
    assert missing[0].evidence is not None, "第二 pass 独有的条目应带上它的原文位置"


def test_group_only_in_one_pass_is_missing() -> None:
    a = _result([_group("Required", 30, [])])
    b = _result([_group("Required", 30, []), _group("Extra", 6, [])])
    report = diff_results(a, b, {})

    assert [f.path for f in report.missing] == ["groups[1]"]


def test_evidence_is_attached_to_agree_findings() -> None:
    a = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    b = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    ev = _evidence()
    report = diff_results(a, b, {"groups[0].courses[0]": ev})

    course_finding = next(f for f in report.agreed if f.path == "groups[0].courses[0].credits")
    assert course_finding.evidence == ev


def test_agree_confidence_is_one_and_conflict_is_lower() -> None:
    a = _result([_group("Required", 30, [("COMP1023", 3.0)])])
    b = _result([_group("Required", 36, [("COMP1023", 4.0)])])
    report = diff_results(a, b, {})

    assert report.conflicts[0].confidence < 1.0

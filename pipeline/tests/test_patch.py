"""patch 单测：把仲裁结论应用到抽取结果上。

final_patch 的键是 finding.path，值可能来自第二 pass 或 LLM judge ——
都是不可信输入，路径解析必须严格，越界与非法字段一律跳过而不是乱写。
"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from agents.patch import apply_patch  # noqa: E402
from schemas import ExtractedCourse, ExtractedGroup, ExtractionResult  # noqa: E402


def _result() -> ExtractionResult:
    return ExtractionResult(
        year="2026-27",
        code="COMP",
        title="BEng",
        groups=[
            ExtractedGroup(
                name="Required",
                required_credits=30,
                courses=[
                    ExtractedCourse(code="COMP1023", name="Intro", credits=3),
                    ExtractedCourse(code="COMP1024", name="Data", credits=3),
                ],
            )
        ],
    )


def test_patch_applies_to_course_credit() -> None:
    result, applied, skipped = apply_patch(_result(), {"groups[0].courses[0].credits": 4.0})
    assert result.groups[0].courses[0].credits == 4.0
    assert applied == ["groups[0].courses[0].credits"]
    assert skipped == []


def test_patch_applies_to_group_required_credits() -> None:
    result, applied, _ = apply_patch(_result(), {"groups[0].required_credits": 36})
    assert result.groups[0].required_credits == 36
    assert applied == ["groups[0].required_credits"]


def test_patch_does_not_touch_other_courses() -> None:
    result, _, _ = apply_patch(_result(), {"groups[0].courses[0].credits": 4.0})
    assert result.groups[0].courses[1].credits == 3


def test_out_of_range_index_is_skipped() -> None:
    result, applied, skipped = apply_patch(
        _result(), {"groups[9].courses[0].credits": 1.0, "groups[0].courses[9].credits": 1.0}
    )
    assert applied == []
    assert len(skipped) == 2


def test_unknown_field_is_skipped() -> None:
    result, applied, skipped = apply_patch(_result(), {"groups[0].courses[0].nonexistent": 1})
    assert applied == []
    assert skipped == ["groups[0].courses[0].nonexistent"]
    assert result.groups[0].courses[0].credits == 3


def test_malformed_path_is_skipped() -> None:
    _, applied, skipped = apply_patch(_result(), {"nonsense": 1, "groups[a].credits": 1})
    assert applied == []
    assert len(skipped) == 2


def test_empty_patch_leaves_result_unchanged() -> None:
    before = _result()
    after, applied, skipped = apply_patch(_result(), {})
    assert after == before
    assert applied == [] and skipped == []

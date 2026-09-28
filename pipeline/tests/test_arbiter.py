"""arbiter 单测：分歧裁决与「不决」分支。

核心不变量：**无法自决时必须标 unresolved，绝不静默改数。**
宁可让人看一眼，也不能让幻觉进库。
"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from agents.arbiter import arbitrate  # noqa: E402
from agents.schemas import (  # noqa: E402
    DeterministicIssue,
    DiffKind,
    DiffReport,
    Evidence,
    Finding,
)


def _finding(
    path: str,
    kind: DiffKind,
    value_a=None,
    value_b=None,
    evidence: Evidence | None = None,
) -> Finding:
    return Finding(
        path=path,
        field="credits",
        kind=kind,
        value_a=value_a,
        value_b=value_b,
        evidence=evidence,
        confidence=1.0 if kind is DiffKind.AGREE else 0.5,
    )


def _report(findings: list[Finding]) -> DiffReport:
    return DiffReport(year="2026-27", code="COMP", findings=findings)


def _evidence() -> Evidence:
    return Evidence(chunk_id="abc", page=2, char_start=5, char_end=9)


def test_agree_findings_are_auto_accepted() -> None:
    report = _report([_finding("groups[0].required_credits", DiffKind.AGREE, 30, 30)])
    out = arbitrate(report, deterministic_issues=[])

    assert out.accepted == ["groups[0].required_credits"]
    assert out.unresolved == []
    assert not out.needs_human_review


def test_conflict_without_judge_is_unresolved() -> None:
    report = _report([_finding("groups[0].courses[0].credits", DiffKind.CONFLICT, 3.0, 4.0)])
    out = arbitrate(report, deterministic_issues=[])

    assert out.unresolved == ["groups[0].courses[0].credits"]
    assert out.needs_human_review
    assert out.final_patch == {}


def test_conflict_resolved_by_judge_is_patched() -> None:
    report = _report([_finding("groups[0].courses[0].credits", DiffKind.CONFLICT, 3.0, 4.0)])
    out = arbitrate(report, deterministic_issues=[], judge_fn=lambda f: 4.0)

    assert out.accepted == ["groups[0].courses[0].credits"]
    assert out.final_patch == {"groups[0].courses[0].credits": 4.0}


def test_judge_failure_marks_unresolved_instead_of_crashing() -> None:
    def boom(_f):
        raise RuntimeError("LLM 不可用")

    report = _report([_finding("groups[0].courses[0].credits", DiffKind.CONFLICT, 3.0, 4.0)])
    out = arbitrate(report, deterministic_issues=[], judge_fn=boom)

    assert out.unresolved == ["groups[0].courses[0].credits"]


def test_judge_returning_none_means_cannot_decide() -> None:
    report = _report([_finding("groups[0].courses[0].credits", DiffKind.CONFLICT, 3.0, 4.0)])
    out = arbitrate(report, deterministic_issues=[], judge_fn=lambda f: None)

    assert out.unresolved == ["groups[0].courses[0].credits"]


def test_finding_with_deterministic_issue_is_not_overridden_by_judge() -> None:
    """确定性校验说账对不上时，不许 LLM 猜一个数覆盖过去。"""
    path = "groups[0].courses[0].credits"
    report = _report([_finding(path, DiffKind.CONFLICT, 3.0, 4.0)])
    issues = [DeterministicIssue(type="credits_raw_mismatch", path=path, detail="对不上")]
    out = arbitrate(report, deterministic_issues=issues, judge_fn=lambda f: 4.0)

    assert out.unresolved == [path]
    assert out.final_patch == {}


def test_missing_only_in_b_with_evidence_is_accepted() -> None:
    """第二 pass 多找到一门课，且能定位到原文 —— 采纳。"""
    report = _report(
        [_finding("groups[0].courses[1].credits", DiffKind.MISSING, None, 3.0, _evidence())]
    )
    out = arbitrate(report, deterministic_issues=[])

    assert out.accepted == ["groups[0].courses[1].credits"]
    assert out.final_patch == {"groups[0].courses[1].credits": 3.0}


def test_missing_only_in_a_keeps_pass_a_value() -> None:
    """第二 pass 漏了一门课 —— 保留第一 pass 的值，不改数。"""
    report = _report(
        [_finding("groups[0].courses[1].credits", DiffKind.MISSING, 3.0, None)]
    )
    out = arbitrate(report, deterministic_issues=[])

    assert out.rejected == ["groups[0].courses[1].credits"]
    assert out.final_patch == {}


def test_missing_only_in_b_without_evidence_is_unresolved() -> None:
    """第二 pass 多出的课定位不到原文 —— 当作幻觉嫌疑，交人工。"""
    report = _report(
        [_finding("groups[0].courses[1].credits", DiffKind.MISSING, None, 3.0, None)]
    )
    out = arbitrate(report, deterministic_issues=[])

    assert out.unresolved == ["groups[0].courses[1].credits"]

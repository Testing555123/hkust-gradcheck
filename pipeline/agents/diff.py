"""两 pass 结果的字段级对齐与比对。

对齐规则（这是 diff 正确性的全部基础）：
- 组按 **name** 对齐，不按出现顺序 —— 两 pass 对组边界的判断可能不同；
- 组内课程按 **code** 对齐 —— code 是课程的唯一标识。

只比对两类数值字段：
- 组的 `required_credits`
- 课程的 `credits`

课名/area 不比对：第二 pass 的表述差异（大小写、连字符）会造成大量假冲突，
性价比低；这类语义分歧留给 arbiter，且只在学分对不上时才触发。
"""

from __future__ import annotations

from typing import Any

from agents.schemas import DiffKind, DiffReport, Evidence, Finding
from schemas import ExtractionResult

AGREE_CONFIDENCE = 1.0
DISPUTED_CONFIDENCE = 0.5


def _finding(
    path: str,
    field: str,
    kind: DiffKind,
    value_a: Any | None,
    value_b: Any | None,
    evidence: Evidence | None,
) -> Finding:
    return Finding(
        path=path,
        field=field,
        kind=kind,
        value_a=value_a,
        value_b=value_b,
        evidence=evidence,
        confidence=AGREE_CONFIDENCE if kind is DiffKind.AGREE else DISPUTED_CONFIDENCE,
    )


def _compare(
    findings: list[Finding],
    path: str,
    field: str,
    value_a: Any,
    value_b: Any,
    evidence: Evidence | None,
) -> None:
    kind = DiffKind.AGREE if value_a == value_b else DiffKind.CONFLICT
    findings.append(_finding(path, field, kind, value_a, value_b, evidence))


def diff_results(
    result_a: ExtractionResult,
    result_b: ExtractionResult,
    evidence_b: dict[str, Evidence],
) -> DiffReport:
    """比对两份抽取结果，产出字段级 findings。

    evidence_b 的键是**第二 pass 自己的路径**（如 groups[0].courses[1]），
    因此对齐时必须同时记住 B 侧下标，才能取回正确的原文位置。
    """
    findings: list[Finding] = []

    b_groups: dict[str, tuple[int, Any]] = {
        g.name: (i, g) for i, g in enumerate(result_b.groups)
    }
    matched_b_group_indexes: set[int] = set()

    for gi, ga in enumerate(result_a.groups):
        hit = b_groups.get(ga.name)
        if hit is None:
            findings.append(
                _finding(
                    f"groups[{gi}]", "group", DiffKind.MISSING, ga.name, None, None
                )
            )
            continue

        bi, gb = hit
        matched_b_group_indexes.add(bi)
        group_path = f"groups[{gi}]"

        _compare(
            findings,
            f"{group_path}.required_credits",
            "required_credits",
            ga.required_credits,
            gb.required_credits,
            evidence_b.get(f"groups[{bi}]"),
        )

        b_courses: dict[str, tuple[int, Any]] = {
            c.code: (i, c) for i, c in enumerate(gb.courses)
        }
        matched_b_courses: set[str] = set()

        for ci, ca in enumerate(ga.courses):
            course_path = f"{group_path}.courses[{ci}]"
            b_hit = b_courses.get(ca.code)
            if b_hit is None:
                findings.append(
                    _finding(
                        f"{course_path}.credits",
                        "credits",
                        DiffKind.MISSING,
                        ca.credits,
                        None,
                        None,
                    )
                )
                continue
            bci, cb = b_hit
            matched_b_courses.add(ca.code)
            _compare(
                findings,
                f"{course_path}.credits",
                "credits",
                ca.credits,
                cb.credits,
                evidence_b.get(f"groups[{bi}].courses[{bci}]"),
            )

        # 第二 pass 独有的课程
        for bci, cb in enumerate(gb.courses):
            if cb.code in matched_b_courses:
                continue
            findings.append(
                _finding(
                    f"{group_path}.courses[{bci}].credits",
                    "credits",
                    DiffKind.MISSING,
                    None,
                    cb.credits,
                    evidence_b.get(f"groups[{bi}].courses[{bci}]"),
                )
            )

    # 第二 pass 独有的组
    for bi, gb in enumerate(result_b.groups):
        if bi in matched_b_group_indexes:
            continue
        findings.append(
            _finding(
                f"groups[{bi}]", "group", DiffKind.MISSING, None, gb.name,
                evidence_b.get(f"groups[{bi}]"),
            )
        )

    return DiffReport(year=result_a.year, code=result_a.code, findings=findings)

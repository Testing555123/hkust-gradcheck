"""确定性校验：不依赖 LLM 的事实性判定。

设计原则：**能用纯函数判定的，绝不交给 LLM。**
学分是否自洽、课号是否合法、必填是否缺失、source_pdf 是否绝对路径——
这些都是事实判断，纯函数既便宜又可复现，还能单测。
LLM（arbiter）只处理纯函数判不了的语义分歧。

优先级：确定性校验的结论高于两 pass 的多数投票。
两 pass 都说是 3 学分，但 credits_raw 写着 "4-6"，那仍然是问题。
"""

from __future__ import annotations

import re

from agents.schemas import DeterministicIssue
from crosscheck import parse_credits
from schemas import ExtractionResult

# HKUST 课号：2-5 个大写字母 + 4 位数字 + 可选后缀字母（如 COMP1022P 的 P 表示实验）。
# 位数放宽到 2-5 是因为 BMH / AI 这类短代码确实存在，但必须无空格、全大写。
COURSE_CODE_RE = re.compile(r"^[A-Z]{2,5}\d{4}[A-Z]?$")

# Windows 盘符路径、POSIX 根路径、UNC 路径
_ABSOLUTE_PATH_RE = re.compile(r"^(?:[A-Za-z]:)?[\\/]")


def validate_course_code(code: str | None) -> bool:
    """课号是否合法（规范化后：无空格、全大写）。"""
    return bool(COURSE_CODE_RE.match(code or ""))


def check_source_pdf(source_pdf: str | None) -> list[DeterministicIssue]:
    """gates.ts 会拒绝本机绝对路径入库，必须在写库前拦下。"""
    if not source_pdf:
        return []
    if _ABSOLUTE_PATH_RE.match(source_pdf):
        return [
            DeterministicIssue(
                type="absolute_source_pdf",
                path="source_pdf",
                detail=f"source_pdf 是绝对路径，Payload 闸门会拒绝：{source_pdf}",
            )
        ]
    return []


def _credits_match_raw(credits: float, credits_raw: str) -> bool:
    """credits 是否等于 credits_raw 的下限（范围是取下限的约定）。"""
    if not credits_raw:
        return True
    parsed = parse_credits(credits_raw)
    if parsed is None:
        return True
    return abs(parsed - credits) < 1e-6


def run_all(result: ExtractionResult, source_pdf: str | None = None) -> list[DeterministicIssue]:
    """跑完全部确定性校验，返回问题列表（空列表即通过）。"""
    issues: list[DeterministicIssue] = list(check_source_pdf(source_pdf))

    for gi, group in enumerate(result.groups):
        if not (group.name or "").strip():
            issues.append(
                DeterministicIssue(
                    type="missing_group_name",
                    path=f"groups[{gi}]",
                    detail="分组名为空，Payload 闸门会拒绝",
                )
            )

        for ci, course in enumerate(group.courses):
            path = f"groups[{gi}].courses[{ci}]"
            code = (course.code or "").strip()
            if not code:
                issues.append(
                    DeterministicIssue(
                        type="missing_course_code",
                        path=path,
                        detail="课程代码为空，Payload 闸门会拒绝",
                    )
                )
            elif not validate_course_code(code):
                issues.append(
                    DeterministicIssue(
                        type="invalid_course_code",
                        path=path,
                        detail=f"课号不合法：{course.code!r}",
                    )
                )

            if not _credits_match_raw(course.credits, course.credits_raw):
                issues.append(
                    DeterministicIssue(
                        type="credits_raw_mismatch",
                        path=path,
                        detail=(
                            f"credits={course.credits} 与 credits_raw={course.credits_raw!r} "
                            "的下限不一致"
                        ),
                    )
                )

    return issues

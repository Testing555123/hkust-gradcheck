"""仲裁：只处理 diff 判不了的分歧项。

裁决顺序（越靠前越可信，绝不反过来）：
1. 两 pass 一致 -> 直接采纳，不惊动 LLM；
2. 该路径已被确定性校验标记为事实不一致 -> **不决**，交人工。
   理由：账目对不上是事实问题，让 LLM 猜一个数覆盖过去等于掩盖错误；
3. 第二 pass 独有且能溯源 -> 采纳（原文里确实有，第一 pass 漏了）；
4. 第二 pass 独有但无法溯源 -> **不决**（幻觉嫌疑）；
5. 第一 pass 独有 -> 保留第一 pass 的值（不改数）；
6. 真正的语义冲突 -> 交给 LLM judge；judge 不可用/返回空 -> **不决**。

「不决」是设计的一部分，不是失败：unresolved 会落 validation-issues 等人看。
"""

from __future__ import annotations

import json
from typing import Any, Callable, Sequence

from agents.schemas import (
    ArbitrationResult,
    DeterministicIssue,
    DiffKind,
    DiffReport,
    Finding,
)

# 给 judge 的原文上下文窗口（字符）。太小看不懂表格，太大浪费 token。
CONTEXT_CHARS = 400

ARBITER_PROMPT = """You are adjudicating a disagreement between two independent extractions of the same
HKUST program requirement PDF. Both extractions were produced from the text below.

Decide which value is correct, using ONLY the excerpt as evidence.

Respond with strict JSON:
{"decidable": true, "value": <the correct value>, "reason": "..."}
or, if the excerpt genuinely cannot settle it:
{"decidable": false, "value": null, "reason": "..."}

Never guess. If the excerpt does not contain the answer, set decidable to false.
The value type must match the field: number for credits, string for text."""


def _excerpt_of(finding: Finding, full_text: str) -> str:
    if finding.evidence is None:
        return ""
    start = max(0, finding.evidence.char_start - CONTEXT_CHARS)
    end = min(len(full_text), finding.evidence.char_end + CONTEXT_CHARS)
    return full_text[start:end]


def make_llm_judge(full_text: str) -> Callable[[Finding], Any] | None:
    """构造 LLM judge；没有 API key 时返回 None（调用方退化为全不决）。

    judge 返回「正确值」，返回 None 表示无法自决。
    """
    try:
        from llm_extract import get_client, next_model

        client = get_client()
    except RuntimeError:
        return None

    def judge(finding: Finding) -> Any | None:
        payload = (
            f"field: {finding.path} ({finding.field})\n"
            f"value from extraction A: {finding.value_a!r}\n"
            f"value from extraction B: {finding.value_b!r}\n\n"
            f"--- excerpt from the PDF ---\n{_excerpt_of(finding, full_text)}"
        )
        resp = client.chat.completions.create(
            model=next_model(),
            temperature=0,
            response_format={"type": "json_object"},
            timeout=120.0,
            messages=[
                {"role": "system", "content": ARBITER_PROMPT},
                {"role": "user", "content": payload},
            ],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        if not data.get("decidable"):
            return None
        return data.get("value")

    return judge


def arbitrate(
    report: DiffReport,
    deterministic_issues: Sequence[DeterministicIssue] = (),
    judge_fn: Callable[[Finding], Any] | None = None,
) -> ArbitrationResult:
    """对 diff 产出的分歧逐条裁决。"""
    blocked = {issue.path for issue in deterministic_issues}
    out = ArbitrationResult()

    for finding in report.findings:
        if finding.kind is DiffKind.AGREE:
            out.accepted.append(finding.path)
            continue

        if finding.path in blocked:
            out.unresolved.append(finding.path)
            continue

        if finding.kind is DiffKind.MISSING:
            if finding.value_b is not None and finding.evidence is not None:
                out.accepted.append(finding.path)
                out.final_patch[finding.path] = finding.value_b
            elif finding.value_b is None:
                # 第二 pass 漏了：保留第一 pass 的值，不改数
                out.rejected.append(finding.path)
            else:
                out.unresolved.append(finding.path)
            continue

        if judge_fn is None:
            out.unresolved.append(finding.path)
            continue

        try:
            decision = judge_fn(finding)
        except Exception:  # noqa: BLE001 — LLM 不可用不应砸掉整批
            out.unresolved.append(finding.path)
            continue

        if decision is None:
            out.unresolved.append(finding.path)
        else:
            out.accepted.append(finding.path)
            out.final_patch[finding.path] = decision

    return out

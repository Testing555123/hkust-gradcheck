"""第二 pass 抽取：用 langextract 独立再抽一遍，并带回原文字符区间。

与 `llm_extract.py`（Pass A）的分工：

|          | Pass A (llm_extract)      | Pass B (langextract)            |
|----------|---------------------------|---------------------------------|
| 目的     | 产出主结果（已验证 255 份） | 第二意见 + 原文溯源              |
| 输出     | 嵌套 ExtractionResult      | 扁平 extractions + char_interval |
| 溯源     | source_pages（页级）       | char_interval（字符级）          |

Pass B **不**负责写库，也不推翻 Pass A；它只产出一份同形的结果与证据表，
交给 `agents/diff.py` 做字段级比对。

为什么要 `output_schema`：langextract 原生输出是扁平的
`extractions[].attributes`，与 `ExtractionResult` 的 `groups[].courses[]`
不同形，没法直接 diff。用 output_schema 把 attributes 强制成
「kind + 组字段 + 课字段」的判别式结构，装配后即可同形比对。
"""

from __future__ import annotations

import functools
import os
from typing import Any, Callable

import langextract as lx
from langextract import schema as lxschema
from langextract.factory import ModelConfig

from agents.schemas import Evidence, PassBResult
from grounding import build_chunks, locate
from llm_extract import next_model
from parsers.base import ParsedDocument
from schemas import ExtractedCourse, ExtractedGroup, ExtractionResult

EXTRACTION_CLASS = "requirement"

# 所有属性都是 required（langextract 生成 schema 时的规则），
# 因此不适用的字段要求模型填空值：字符串 ""、数字 0、数组 []。
ATTRIBUTES: dict[str, dict[str, Any]] = {
    "kind": {"type": "string", "enum": ["group", "course"]},
    "group_name": {"type": "string"},
    "required_credits": {"type": "number"},
    "required_credits_raw": {"type": "string"},
    "note": {"type": "string"},
    "code": {"type": "string"},
    "name": {"type": "string"},
    "credits": {"type": "number"},
    "credits_raw": {"type": "string"},
    "areas": {"type": "array", "items": {"type": "string"}},
}

# 与 Pass A 刻意不同的措辞与视角：Pass A 是「照抄表格」，
# Pass B 是「逐行核对出处」，降低两 pass 犯同一个错的概率。
PASS_B_PROMPT = """You are auditing a HKUST program requirement PDF. Pages are marked `===== [PAGE n] =====`.

Walk the document top to bottom and emit ONE extraction per requirement group and ONE per course row,
in the order they appear. For every extraction, `extraction_text` MUST be a verbatim quote from the
document — that is how your output gets traced back to the page.

Attributes:
- kind: "group" for a requirement-group heading row, "course" for a course row.
- group_name: for kind="group" the heading itself; for kind="course" the heading of the group it belongs to.
- required_credits / required_credits_raw: from the group's "Credit(s) attained" cell (lower bound for ranges).
- note: the group's OR/AND combination note verbatim, else "".
- code / name / credits / credits_raw: course fields. Normalize code to no-space uppercase (COMP + 1023 -> COMP1023).
- areas: elective area headings this course sits under (without the trailing word "Area"), else [].

For kind="group", leave code/name/credits_raw as "" and credits as 0, and areas as [].
Never invent a course. If a row is unreadable, skip it rather than guessing."""

MAX_CHAR_BUFFER = 1000
EXTRACTION_PASSES = 1


def build_output_schema() -> dict[str, Any]:
    """构造 langextract 的 output_schema 信封（强制两 pass 同形）。"""
    item = lxschema.extraction_item_schema(EXTRACTION_CLASS, attributes=ATTRIBUTES)
    return lxschema.extractions_schema(item)


def _model_config() -> ModelConfig:
    api_key = os.environ.get("GRAD_LLM_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "缺少 GRAD_LLM_API_KEY 环境变量：第二 pass 无法调用 LLM。"
            "可只跑 Pass A + 确定性校验（--no-pass-b）。"
        )
    return ModelConfig(
        model_id=next_model(),
        provider="openai",
        provider_kwargs={
            "api_key": api_key,
            "base_url": os.environ.get("GRAD_LLM_BASE_URL", "https://api.openai.com/v1"),
        },
    )


def _assemble(
    annotated: Any,
    chunks: list,
    year: str,
    code: str,
) -> PassBResult:
    """把扁平 extractions 装配成与 Pass A 同形的 ExtractionResult + 证据表。"""
    if isinstance(annotated, list):
        annotated = annotated[0] if annotated else None

    groups: list[ExtractedGroup] = []
    evidence: dict[str, Evidence] = {}
    degraded = 0
    uncertain: list[str] = []

    if annotated is None:
        return PassBResult(result=ExtractionResult(year=year, code=code, title=""))

    for ext in annotated.extractions:
        attrs: dict[str, Any] = ext.attributes or {}
        interval = ext.char_interval
        if interval is None:
            # 模型编的、原文里定位不到 —— 防幻觉闸门，直接丢弃
            degraded += 1
            label = attrs.get("code") or attrs.get("group_name") or ext.extraction_text[:40]
            uncertain.append(f"第二 pass 无法溯源，已丢弃：{label}")
            continue

        chunk = locate(chunks, interval.start_pos, interval.end_pos)
        kind = attrs.get("kind")

        if kind == "group":
            groups.append(
                ExtractedGroup(
                    name=str(attrs.get("group_name") or ""),
                    required_credits=float(attrs.get("required_credits") or 0),
                    required_credits_raw=str(attrs.get("required_credits_raw") or ""),
                    note=str(attrs.get("note") or ""),
                )
            )
            path = f"groups[{len(groups) - 1}]"
        else:
            if not groups:
                # 课程先于任何分组出现：用课程自带的 group_name 兜底建一个组
                groups.append(
                    ExtractedGroup(
                        name=str(attrs.get("group_name") or ""),
                        required_credits=float(attrs.get("required_credits") or 0),
                        required_credits_raw=str(attrs.get("required_credits_raw") or ""),
                        note=str(attrs.get("note") or ""),
                    )
                )
            idx = len(groups) - 1
            groups[idx].courses.append(
                ExtractedCourse(
                    code=str(attrs.get("code") or ""),
                    name=str(attrs.get("name") or ""),
                    credits=float(attrs.get("credits") or 0),
                    credits_raw=str(attrs.get("credits_raw") or ""),
                    areas=list(attrs.get("areas") or []),
                    source_pages=[chunk.page] if chunk else [],
                )
            )
            path = f"groups[{idx}].courses[{len(groups[idx].courses) - 1}]"

        if chunk is not None:
            evidence[path] = Evidence(
                chunk_id=chunk.chunk_id,
                page=chunk.page,
                char_start=interval.start_pos,
                char_end=interval.end_pos,
            )

    return PassBResult(
        result=ExtractionResult(year=year, code=code, title="", groups=groups),
        evidence=evidence,
        degraded=degraded,
        uncertain=uncertain,
    )


def run_pass_b(
    doc: ParsedDocument,
    year: str,
    code: str,
    program_key: str,
    extract_fn: Callable[..., Any] | None = None,
) -> PassBResult:
    """执行第二 pass。

    extract_fn 用于注入假的抽取器（单测用）；为 None 时才真正调用 langextract。
    title 留空是刻意的：专业名称由 index.json / Pass A 提供，
    第二 pass 只负责组与课程，diff 也不比对 title。
    """
    text = doc.text_with_page_markers()
    chunks = build_chunks(doc, program_key)

    if extract_fn is None:
        extract_fn = functools.partial(
            lx.extract,
            config=_model_config(),
            output_schema=build_output_schema(),
            max_char_buffer=MAX_CHAR_BUFFER,
            extraction_passes=EXTRACTION_PASSES,
            temperature=0,
        )

    annotated = extract_fn(text_or_documents=text, prompt_description=PASS_B_PROMPT)
    return _assemble(annotated, chunks, year, code)

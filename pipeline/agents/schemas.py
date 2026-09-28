"""双 pass 核对的 Pydantic 契约。

刻意**不**把这些字段塞进 `schemas.ExtractionResult`：
那是已固化的产物契约（喂给 programs.source、被 export_static_data 校验），
加字段会扩大 blast radius。证据与核对结果单独走一份平行结构。
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from schemas import ExtractionResult


class Evidence(BaseModel):
    """一条抽取结论在原文中的位置（由 langextract 的 char_interval 映射而来）。"""

    chunk_id: str = Field(description="稳定切片 id，回指切片层")
    page: int = Field(description="1-based 页码")
    char_start: int = Field(description="相对 text_with_page_markers() 的起始偏移")
    char_end: int


class PassBResult(BaseModel):
    """第二 pass（langextract）的产物。

    evidence 以路径为键，如 "groups[0].courses[3]"，供 diff 阶段逐字段溯源。
    degraded 记录因无法溯源而被丢弃的条目数——它是防幻觉闸门的计数器。
    """

    result: ExtractionResult
    evidence: dict[str, Evidence] = Field(default_factory=dict)
    degraded: int = Field(default=0, description="char_interval 缺失而被丢弃的条目数")
    uncertain: list[str] = Field(default_factory=list)


class DiffKind(str, Enum):
    """两 pass 对同一字段的比对结果。"""

    AGREE = "agree"  # 一致 -> 直接采纳
    CONFLICT = "conflict"  # 都有值但不同 -> 交仲裁
    MISSING = "missing"  # 只有一方有 -> 交仲裁


class Finding(BaseModel):
    """一条字段级比对结论。"""

    path: str = Field(description='如 groups[0].courses[3].credits')
    kind: DiffKind
    field: str = Field(description="被比对的字段名，如 credits / required_credits")
    value_a: Any | None = None
    value_b: Any | None = None
    evidence: Evidence | None = Field(
        default=None, description="第二 pass 的原文位置；None 表示无法溯源"
    )
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class ArbitrationResult(BaseModel):
    """仲裁结论。

    accepted / rejected / unresolved 都是 finding.path 列表。
    unresolved 非空即 needs_human_review —— 宁可不决，也不猜。
    """

    accepted: list[str] = Field(default_factory=list)
    rejected: list[str] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    final_patch: dict[str, Any] = Field(default_factory=dict)

    @property
    def needs_human_review(self) -> bool:
        return bool(self.unresolved)


class DeterministicIssue(BaseModel):
    """确定性校验发现的问题（纯函数判定，可单测、零成本、可复现）。"""

    type: str = Field(
        description="invalid_course_code / missing_group_name / missing_course_code / credits_raw_mismatch / absolute_source_pdf"
    )
    path: str
    detail: str


class DiffReport(BaseModel):
    year: str
    code: str
    findings: list[Finding] = Field(default_factory=list)

    @property
    def conflicts(self) -> list[Finding]:
        return [f for f in self.findings if f.kind == DiffKind.CONFLICT]

    @property
    def missing(self) -> list[Finding]:
        return [f for f in self.findings if f.kind == DiffKind.MISSING]

    @property
    def agreed(self) -> list[Finding]:
        return [f for f in self.findings if f.kind == DiffKind.AGREE]

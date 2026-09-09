"""分支（Track / Option）识别规则。

背景：HKUST 培养方案里，同一主修内部常提供若干「互斥分支方向」，学生只能择一修读，
而不同分支的最低学分下限不同。官方只用两种叫法：**Track** 与 **Option**
（Stream / Concentration / Specialization / Focus / Pathway 在产物组名中零出现）。

历史命名范式（产物 group name，需全部兼容）：
- 25-26 / 26-27：`<名> Track|Option Required Course(s)` / `… Elective Course(s)` / `… Elective(s)` / `… Other(s)`
- 26-27 GCS 变体：`<名> Track Restricted Electives`（分支词后面还跟别的词）
- 23-24：`Option(s) - <名> Option`、`Track Study - <名> Track`、裸名 `IRE Track` / `Research Option`
- SREQ-SSCI：`SSCI Additional Required Courses for IRE Track`（分支词在句尾且带 for）

本模块只做**确定性**识别（正则 + 关键词），不调用 LLM，便于反复重跑与 git diff 审查。
置信度三档：override（人工补回）> name_regex（组名正则）> note_keyword（Note 关键词）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

KIND_TRACK = "track"
KIND_OPTION = "option"

CONF_OVERRIDE = "override"
CONF_NAME = "name_regex"
CONF_NOTE = "note_keyword"

# 23-24 的前缀式命名：Option(s) - X Option / Track Study - X Track
_PREFIX_RE = re.compile(
    r"^\s*(?:option\(s\)|options?|track\s+study|track)\s*[-–:]\s*", re.IGNORECASE
)
# 分支词在句尾且由 for 引导：… for IRE Track
_FOR_BRANCH_RE = re.compile(r"\s+for\s+(?P<name>.+?\s+(?:track|option))\s*$", re.IGNORECASE)
# 取「最靠前的一个 <名> Track|Option」作为分支名（分支词后可能仍跟 Required/Restricted 等词）
_BRANCH_HEAD_RE = re.compile(r"^(?P<name>.+?\s+(?:track|option))(?=\W|$)", re.IGNORECASE)

# Note / uncertain 中判定「互斥」的关键词
_MUTEX_KEYWORDS = (
    "mutually exclusive",
    "should follow one of",
    "should follow one",
    "students should follow one",
    "track study:",
    "optional and excluded from",
    "double-count",
    "double counts",
)
# Note 中提到某个具体分支名（用于发现组名里没写分支的隐性分支组）
_NOTE_BRANCH_RE = re.compile(
    r"(?P<name>[A-Z][A-Za-z]+(?:\s+[A-Z(][A-Za-z()&/'-]*){0,6}\s+(?:Track|Option))\b"
)


@dataclass(frozen=True)
class BranchMatch:
    """一次分支识别结果。"""

    branch: str
    kind: str
    confidence: str

    def as_fields(self, parent: str | None = None, optional: bool = True) -> dict:
        """转成写入 requirement group 的四个字段。"""
        return {
            "branch": self.branch,
            "branch_kind": self.kind,
            "branch_optional": optional,
            "parent_branch": parent,
        }


def _clean(name: str) -> str:
    """压缩空白并去掉首尾分隔符，让后续正则稳定。"""
    return re.sub(r"\s+", " ", (name or "").strip()).strip("-–: ").strip()


def detect_branch_from_name(name: str) -> BranchMatch | None:
    """从要求组名里识别分支；识别不出返回 None。

    >>> detect_branch_from_name("Applied Mathematics Track Required Course(s)").branch
    'Applied Mathematics Track'
    >>> detect_branch_from_name("Option(s) - Biomolecular Chemistry Option").kind
    'option'
    >>> detect_branch_from_name("Required Course(s)") is None
    True
    """
    cleaned = _clean(name)
    if not cleaned:
        return None

    m = _FOR_BRANCH_RE.search(cleaned)
    if m:
        return BranchMatch(_clean(m.group("name")), _kind_of(m.group("name")), CONF_NAME)

    stripped = _PREFIX_RE.sub("", cleaned)
    m = _BRANCH_HEAD_RE.match(stripped or cleaned)
    if not m:
        return None
    branch = _clean(m.group("name"))
    if not branch:
        return None
    return BranchMatch(branch, _kind_of(branch), CONF_NAME)


def _kind_of(branch: str) -> str:
    return KIND_OPTION if branch.lower().endswith("option") else KIND_TRACK


def mentions_mutex(text: str | None) -> bool:
    """文本是否出现互斥/择一语义的关键词。"""
    if not text:
        return False
    low = text.lower()
    return any(k in low for k in _MUTEX_KEYWORDS)


def detect_branch_candidates_in_note(note: str | None) -> list[str]:
    """从 Note 原文里抽取「被点名的分支名」，用于发现组名未携带分支的隐性分支组。

    例如 MATH 某组的 Note："Students following IRE Track or Pure Mathematics (Advanced)
    Track can only use MATH 2043…" → 抽出 IRE Track / Pure Mathematics (Advanced) Track。
    """
    if not note:
        return []
    found: list[str] = []
    for m in _NOTE_BRANCH_RE.finditer(note):
        name = _clean(m.group("name"))
        if name and name not in found:
            found.append(name)
    return found

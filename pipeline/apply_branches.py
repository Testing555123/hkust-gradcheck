"""给培养方案产物打上「分支（Track / Option）」标记并生成审核报告。

用法：
    py pipeline/apply_branches.py               # 原地只增字段回写 + 生成报告
    py pipeline/apply_branches.py --dry-run     # 只算不写（先审查再落地）
    py pipeline/apply_branches.py --code MATH   # 只看某个专业（配合 --dry-run 调试）

设计要点：
- **只增字段**：仅在识别出分支的组上写 branch / branch_kind / branch_optional / parent_branch；
  未识别的组保持原样（不写 null），把 255 份产物的 diff 控制在可读范围。
- **幂等**：重复运行不产生 diff（保留原有换行风格 CRLF/LF 与末尾换行习惯，键顺序不变）。
- **人工 overrides**：`branches_overrides.json` 支持按 (学年, 专业) 或专业代码，
  用 order_index 区间 / 精确下标强制指定分支，补回组名丢失的产物（如 2026-27 MATH）。
- **不触碰 courses.db**，不调用 LLM。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# Windows 控制台默认 cp950 无法输出中文日志；将 stdout/stderr 重置为 utf-8（Python 3.7+）
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover - 仅防御性
    pass

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent
sys.path.insert(0, str(PIPELINE_DIR))

from branch_rules import (  # noqa: E402
    CONF_NAME,
    CONF_OVERRIDE,
    KIND_OPTION,
    KIND_TRACK,
    BranchMatch,
    detect_branch_candidates_in_note,
    detect_branch_from_name,
    mentions_mutex,
)

OUTPUT_DIR = PIPELINE_DIR / "output"
REPORTS_DIR = PIPELINE_DIR / "reports"
OVERRIDES_PATH = PIPELINE_DIR / "branches_overrides.json"

BRANCH_FIELDS = ("branch", "branch_kind", "branch_optional", "parent_branch")


# ── 读写（保留原文件的换行风格与末尾换行习惯，保证幂等） ──────────────────────────
def _read_json(path: Path) -> tuple[dict, str, bool]:
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    return json.loads(text), ("\r\n" if b"\r\n" in raw else "\n"), text.endswith("\n")


def _dump(data: dict, newline: str, trailing: bool) -> bytes:
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if newline == "\r\n":
        text = text.replace("\n", "\r\n")
    if trailing:
        text += newline
    return text.encode("utf-8")


# ── overrides ─────────────────────────────────────────────────────────────────
def _load_overrides() -> dict:
    if not OVERRIDES_PATH.exists():
        return {"programs": {}}
    return json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))


def _resolve_overrides(overrides: dict, year: str, code: str) -> dict:
    """按 (学年, 专业) 优先、专业代码兜底合并；同名键前者胜出。"""
    programs = overrides.get("programs", {}) or {}
    merged: dict = {}
    for key in (code, f"{year}/{code}"):
        entry = programs.get(key)
        if not entry:
            continue
        for field, value in entry.items():
            if isinstance(value, dict):
                merged.setdefault(field, {}).update(value)
            else:
                merged[field] = value
    return merged


def _forced_indexes(ov: dict) -> dict[int, tuple[str, str]]:
    """overrides 里的区间 / 精确下标 → {组下标: (分支名, 类型)}。"""
    forced: dict[int, tuple[str, str]] = {}
    for r in ov.get("ranges", []) or []:
        kind = r.get("kind") or (KIND_OPTION if r["branch"].lower().endswith("option") else KIND_TRACK)
        for i in range(int(r["from"]), int(r["to"]) + 1):
            forced[i] = (r["branch"], kind)
    for item in ov.get("indexes", []) or []:
        kind = item.get("kind") or (
            KIND_OPTION if item["branch"].lower().endswith("option") else KIND_TRACK
        )
        forced[int(item["index"])] = (item["branch"], kind)
    return forced


# ── 核心：单份产物的分支标注 ───────────────────────────────────────────────────
def annotate(data: dict, ov: dict) -> tuple[dict[int, dict], list[str], set[int]]:
    """返回 {组下标: 四个分支字段}、警告列表与「由 overrides 强制指定」的下标集合。

    不修改传入的 data。
    """
    warnings: list[str] = []
    groups = data.get("groups", []) or []
    forced = _forced_indexes(ov)
    ignored = {int(i) for i in (ov.get("ignore_indexes") or [])}
    parents: dict[str, str] = ov.get("parents") or {}
    optional_map: dict[str, bool] = ov.get("optional") or {}

    matches: dict[int, BranchMatch] = {}
    for i, g in enumerate(groups):
        if i in ignored:
            continue
        if i in forced:
            branch, kind = forced[i]
            matches[i] = BranchMatch(branch, kind, CONF_OVERRIDE)
            continue
        m = detect_branch_from_name(g.get("name") or "")
        if m:
            matches[i] = m

    branch_names = {m.branch for m in matches.values()}
    fields: dict[int, dict] = {}
    for i, m in sorted(matches.items()):
        parent = parents.get(m.branch)
        if parent and parent not in branch_names:
            warnings.append(f"组 #{i} 的父分支「{parent}」不在本方案分支清单中，已忽略")
            parent = None
        fields[i] = m.as_fields(
            parent=parent, optional=bool(optional_map.get(m.branch, True))
        )
        # 父分支必须存在时才可能形成两级；父分支自身不应再挂父
        if parent and parent == m.branch:
            warnings.append(f"组 #{i} 的父分支指向自身，已忽略")
            fields[i]["parent_branch"] = None
    return fields, warnings, {i for i in forced if i in fields}


def _apply_fields(data: dict, fields: dict[int, dict]) -> bool:
    """把字段写回 data；返回是否发生变化。"""
    changed = False
    groups = data.get("groups", []) or []
    for i, g in enumerate(groups):
        want = fields.get(i)
        if want is None:
            for key in BRANCH_FIELDS:
                if key in g:
                    del g[key]
                    changed = True
            continue
        if any(g.get(key) != want[key] for key in BRANCH_FIELDS):
            changed = True
        # 统一重写，保证键顺序恒为 branch → branch_kind → branch_optional → parent_branch
        for key in BRANCH_FIELDS:
            g.pop(key, None)
            g[key] = want[key]
    return changed


# ── 报告 ──────────────────────────────────────────────────────────────────────
def _credits(g: dict) -> float:
    return float(g.get("required_credits") or 0.0)


def build_report_rows(data: dict, fields: dict[int, dict]) -> dict:
    groups = data.get("groups", []) or []
    branches: dict[str, dict] = {}
    core = 0.0
    for i, g in enumerate(groups):
        f = fields.get(i)
        if not f:
            core += _credits(g)
            continue
        name = f["branch"]
        b = branches.setdefault(
            name,
            {
                "name": name,
                "kind": f["branch_kind"],
                "parent": f["parent_branch"],
                "optional": f["branch_optional"],
                "credits": 0.0,
                "groups": [],
            },
        )
        b["credits"] += _credits(g)
        b["groups"].append(i)
        if f["branch_kind"] != b["kind"]:  # 极少数同名的 track/option 混写
            b["kind"] = f"{b['kind']}/{f['branch_kind']}"

    hidden: list[dict] = []
    program_text = " ".join(data.get("uncertain", []) or [])
    if mentions_mutex(program_text) or branches:
        for i, g in enumerate(groups):
            if fields.get(i):
                continue
            cands = detect_branch_candidates_in_note(g.get("note"))
            if cands:
                hidden.append({"index": i, "name": g.get("name", ""), "candidates": cands})

    return {"core": core, "branches": branches, "hidden": hidden}


def render_report(year: str, entries: list[dict]) -> str:
    lines = [
        f"# {year} 分支（Track / Option）识别审核报告",
        "",
        f"> 由 `pipeline/apply_branches.py` 生成于 {datetime.now():%Y-%m-%d %H:%M:%S}。"
        "置信度来源：override=人工补回、name_regex=组名正则。",
        "",
    ]
    branched = [e for e in entries if e["branches"]]
    if not entries:
        lines.append("本学年未识别出任何分支组。")
        return "\n".join(lines) + "\n"

    lines.append(
        f"本学年共 **{len(branched)}** 份方案含分支组，另有 **{len(entries) - len(branched)}** 份"
        "只存在隐性候选（组名未携带分支，待人工确认）。"
        "「核心学分」= 非分支组 required_credits 之和；「分支学分」= 该分支各组之和。",
    )
    for e in entries:
        lines.append("")
        lines.append(f"## {e['code']} — {e['title']}")
        lines.append("")
        lines.append(f"- 核心学分：**{e['core']:g}**")
        lines.append(f"- 分支数：{len(e['branches'])}")
        if e["warnings"]:
            for w in e["warnings"]:
                lines.append(f"- ⚠️ {w}")
        if e["branches"]:
            lines.append("")
            lines.append("| 分支 | 类型 | 父分支 | 可不选 | 分支学分 | 核心+该分支 | 组下标 |")
            lines.append("|---|---|---|---|---|---|---|")
            for b in e["branches"].values():
                total = e["core"] + b["credits"]
                lines.append(
                    f"| {b['name']} | {b['kind']} | {b['parent'] or '—'} | "
                    f"{'是' if b['optional'] else '否'} | {b['credits']:g} | {total:g} | "
                    f"{', '.join(str(i) for i in b['groups'])} |"
                )
        if e["hidden"]:
            lines.append("")
            lines.append("### 隐性分支候选（组名未携带分支，需人工确认）")
            lines.append("")
            for h in e["hidden"]:
                lines.append(
                    f"- [#{h['index']}] {h['name']}：Note 提到 "
                    + "、".join(h["candidates"])
                )
    return "\n".join(lines) + "\n"


# ── 主流程 ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="为培养方案产物标注 Track / Option 分支")
    ap.add_argument("--dry-run", action="store_true", help="只计算与出报告，不回写产物")
    ap.add_argument("--year", default=None, help="只处理指定学年，如 2025-26")
    ap.add_argument("--code", default=None, help="只处理指定专业代码，如 MATH")
    args = ap.parse_args()

    files = sorted(OUTPUT_DIR.glob("requirements_*.json"))
    if not files:
        print(f"[error] 未找到产物：{OUTPUT_DIR}")
        return 1

    overrides = _load_overrides()
    by_year: dict[str, list[dict]] = {}
    changed_files = 0
    forced_groups = 0
    override_programs = 0
    programs_with_branches = 0

    for f in files:
        data, newline, trailing = _read_json(f)
        if data.get("_skipped_llm"):
            continue
        year, code = data.get("year", ""), data.get("code", "")
        if args.year and year != args.year:
            continue
        if args.code and code.upper() != args.code.upper():
            continue

        ov = _resolve_overrides(overrides, year, code)
        if ov:
            override_programs += 1
        fields, warnings, forced_used = annotate(data, ov)
        forced_groups += len(forced_used)

        if fields:
            programs_with_branches += 1
        rows = build_report_rows(data, fields)
        if rows["branches"] or rows["hidden"]:
            by_year.setdefault(year, []).append(
                {
                    "code": code,
                    "title": data.get("title", ""),
                    "warnings": warnings,
                    **rows,
                }
            )

        if not args.dry_run:
            if _apply_fields(data, fields):
                f.write_bytes(_dump(data, newline, trailing))
                changed_files += 1

    for year, entries in sorted(by_year.items()):
        entries.sort(key=lambda e: e["code"])
        report = render_report(year, entries)
        if not args.dry_run:
            REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            path = REPORTS_DIR / f"branches_{year}.md"
            path.write_text(report, encoding="utf-8")
            print(f"[ok] {path.relative_to(PROJECT_ROOT)}")
        else:
            branched = sum(1 for e in entries if e["branches"])
            print(f"----- {year}（dry-run，含分支 {branched} 份 / 共 {len(entries)} 份待看） -----")
            print(report)

    mode = "dry-run" if args.dry_run else "回写"
    print(
        f"[ok] {mode}完成：{len(files)} 份产物 · 含分支方案 {programs_with_branches} 份 · "
        f"应用 overrides {override_programs} 份（强制指定 {forced_groups} 组）· "
        f"回写 {changed_files} 份"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

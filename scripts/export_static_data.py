"""把管线产物 + 课程库导出为前端可直接 fetch 的静态 JSON。

数据来源（只读）：
- pipeline/output/requirements_*.json  —— 255 份培养方案（LLM 抽取 + 人工校对后的产物）
- courses.db                            —— 官方课程库（1144 门课，只读打开）

产出（写入 frontend/public/data/，随 git 入库，Vite 原样拷贝到 dist）：
- index.json            255 条方案元信息（首屏唯一请求，驱动学年/专业下拉）
- programs/{year}_{code}.json   单份完整要求树（选中后按需加载）
- courses.json          1144 门课详情（学分/先修/开设学期）
- course_index.json     反向索引：课程码 → 被哪些方案的要求组引用
- meta.json             生成时间与数量统计（供 CI 断言）

用法：
    python scripts/export_static_data.py            # 导出
    python scripts/export_static_data.py --check    # 只校验已导出的产物，不写文件

设计要点：
- source_pdf 归一化为仓库相对路径（截取 unpress_pdf/ 之后的部分），避免把本机绝对路径带上公网
- 要求组 id 使用组内序号（order_index），保证 React key 稳定且与 types.ts 契约一致
- 单门课的反向索引条目上限 20 条，防止通识类课程撑爆文件
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
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

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "pipeline" / "output"
SOURCE_DB = ROOT / "courses.db"
DATA_DIR = ROOT / "frontend" / "public" / "data"
PROGRAMS_DIR = DATA_DIR / "programs"
REPORTS_DIR = ROOT / "pipeline" / "reports"

# 组合规则解析器与本脚本同目录：保证以任意 cwd 运行都能导入
sys.path.insert(0, str(Path(__file__).resolve().parent))
from combo_rules import parse_lines  # noqa: E402

# 期望值：CI 用它们断言「网站能看到全部内容」
EXPECTED_PROGRAMS = 255
EXPECTED_COURSES = 1144
EXPECTED_YEARS = ["2023-24", "2024-25", "2025-26", "2026-27"]
# 单个课程码的反向索引条目上限（超出截断并记录真实总数，避免通识类课程撑爆文件）
MAX_INDEX_PER_COURSE = 50
# 导出过程中收集到的「未识别 OR 句式」（导出层填充，报告输出用）
UNRESOLVED_COMBOS: list[dict] = []
# 由符号语法（+ / one of / 小写 or）识别出的组合：抽样人工校对用
SYMBOL_COMBOS: list[dict] = []


def _normalize_source_pdf(raw: str | None) -> str | None:
    """把本机绝对路径归一化为仓库相对路径：…/unpress_pdf/major/2026-27/X.pdf。"""
    if not raw:
        return None
    text = str(raw).replace("\\", "/")
    marker = "unpress_pdf/"
    idx = text.lower().find(marker)
    if idx == -1:
        # 不是本项目的 PDF 路径（例如旧机器产物）：只保留文件名，避免泄漏绝对路径
        return text.rsplit("/", 1)[-1] or None
    return text[idx:]


def _source_ref(pages: list | None, existing: str | None) -> str | None:
    """页码引用：优先保留产物里已有的 source_ref，否则由 source_pages 合成。"""
    if existing:
        return existing
    if not pages:
        return None
    return ", ".join(f"p.{p}" for p in pages)


# ── 开放式层级池检测：单学科 "N000-level or above" 组 ────────────────────────────
_LEVEL_RE = re.compile(r"(2000|3000|4000|5000)\s*-?\s*level or above", re.IGNORECASE)
# 学科紧跟层级短语：<SUBJ> 2000-level or above（兼容 name 或 note 写法）
_SUBJECT_LEVEL_RE = re.compile(
    r"\b([A-Z]{4})\s*(?:/\s*[A-Z]{4}\s*)?(2000|3000|4000|5000)\s*-?\s*level or above",
    re.IGNORECASE,
)
# note 写法："Any <SUBJ> course(s) at 3000-level or above"
_ANY_COURSE_RE = re.compile(r"any\s+([A-Z]{4})\s+courses?", re.IGNORECASE)
# 院/校级合成池（如 COMP/ELEC）不展开为单学科池
_COMBINED_RE = re.compile(r"[A-Z]{4}\s*/\s*[A-Z]{4}")


def _course_index_data() -> tuple[set[str], set[str]]:
    """返回 (4 字母学科前缀集合, 全部真实课程码大写集合)，用于校验池学科是否真实存在。"""
    conn = sqlite3.connect(f"file:{SOURCE_DB}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT code FROM courses").fetchall()
    finally:
        conn.close()
    prefixes: set[str] = set()
    codes: set[str] = set()
    for (code,) in rows:
        if not code:
            continue
        codes.add(code.upper())
        if code[:4].isalpha():
            prefixes.add(code[:4])
    return prefixes, codes


def _parse_credits(raw) -> float | None:
    """学分字符串容错解析：'3 Credit(s)' -> 3.0，'4-6 Credit(s)' -> 4.0（取下限）。"""
    if not raw:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", str(raw))
    return float(m.group(1)) if m else None


def _course_ref(course: dict, course_lookup: dict[str, dict]) -> dict:
    """单门课导出：`credits` 缺失时按 `credits_raw` 取下限，`name` 占位（空/等于课号）时回退课程库。

    产物里偶见 `credits: null` 或 `name == code`（手工补录未填全），直接透传会让前端显示 0 学分 /
    课号，故在此兜底；两者都取不到时保持原值（由 `check()` 断言兜底提示）。
    """
    code = course.get("code", "") or ""
    credits = course.get("credits")
    if credits is None:
        credits = _parse_credits(course.get("credits_raw"))
    name = (course.get("name") or "").strip()
    if not name or name == code:
        lib = course_lookup.get(code.upper().strip())
        if lib and lib.get("name"):
            name = lib["name"]
    return {
        "code": code,
        "name": name,
        "credits": float(credits or 0.0),
        "areas": course.get("areas", []) or [],
    }


def _course_lookup() -> dict[str, dict]:
    """课程库索引：code(大写) -> {name, credits}，用于补齐 Note 里提到但组内缺失的课。"""
    conn = sqlite3.connect(f"file:{SOURCE_DB}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT code, title, credits FROM courses").fetchall()
    finally:
        conn.close()
    return {
        (code or "").upper().strip(): {
            "name": title or "",
            "credits": _parse_credits(credits) or 0.0,
        }
        for code, title, credits in rows
        if code
    }


def detect_pool(
    name: str | None,
    note: str | None,
    existing_codes: list[str],
    real_subjects: set[str],
    real_codes: set[str],
) -> dict | None:
    """识别单学科「N000-level or above」开放选修组，返回 {subject, minLevel}；否则 None。

    排除规则：
    - 院/校级合成池（含 "COMP/ELEC" 之类）
    - 已列出具体真实课程码的组（保留原指定清单，不改为开放池）
    - 学科前缀不在课程库中（SB&M、SSCI、SENG 等无真实 4 字母前缀）
    """
    text = f"{name or ''}\n{note or ''}"
    levels = _LEVEL_RE.findall(text)
    if not levels:
        return None
    if _COMBINED_RE.search(text):
        return None
    if any(c.upper() in real_codes for c in existing_codes):
        return None
    min_level = min(int(l) for l in levels)

    # 学科：优先「<SUBJ> N000-level or above」短语；其次 note 的 "Any <SUBJ> course(s)"
    subject = None
    m = _SUBJECT_LEVEL_RE.search(text)
    if m and m.group(1) in real_subjects:
        subject = m.group(1)
    if not subject:
        m2 = _ANY_COURSE_RE.search(text)
        if m2 and m2.group(1) in real_subjects:
            subject = m2.group(1)
    if not subject:
        return None
    return {"subject": subject, "minLevel": min_level}


def _build_combos(
    note: str | None,
    own_courses: list[dict],
    course_lookup: dict[str, dict],
    group_name: str,
    unresolved_sink: list[dict] | None,
    year: str,
    code: str,
) -> list[dict]:
    """把官方 Note 里的 OR 组合解析成前端可渲染的结构。

    - 备选课优先取本组 courses（学分与别名一致），组内缺失时回退课程库；
    - 课程库也没有的课号进 unresolved，前端只显示文本、不可勾选、不计入学分；
    - 无法判定的句式（含 AND / 散文体 or）写入 unresolved_sink，供人工校对报告使用。
    """
    raw_combos: list[dict] = []
    for record in parse_lines(note):
        for line in record["unresolved"]:
            if unresolved_sink is not None:
                unresolved_sink.append(
                    {"year": year, "code": code, "group": group_name, "note": line}
                )
        if record["combos"]:
            # 符号语法（+ / one of / 小写 or）识别结果单独记一份，供人工抽查误判
            if record["syntax"] == "symbol":
                SYMBOL_COMBOS.append(
                    {"year": year, "code": code, "group": group_name, "note": record["line"]}
                )
            raw_combos.extend(record["combos"])
    if not raw_combos:
        return []

    own = {(c["code"] or "").upper(): c for c in own_courses}

    def resolve(raw_code: str) -> dict | None:
        """课号 → {code,name,credits}：组内课程优先，其次课程库，都没有返回 None。"""
        src = own.get(raw_code)
        if src:
            return {
                "code": src["code"],
                "name": src["name"],
                "credits": float(src["credits"] or 0.0),
            }
        lib = course_lookup.get(raw_code)
        if lib:
            return {"code": raw_code, "name": lib["name"], "credits": lib["credits"]}
        return None

    def build_part(codes: list[str], missing: list[str]) -> dict | None:
        """part：一组「选一门」的备选；全是无法解析的课号时返回 None。"""
        courses = []
        for raw_code in codes:
            item = resolve(raw_code)
            if item:
                courses.append(item)
            elif raw_code not in missing:
                missing.append(raw_code)
        return {"courses": courses} if courses else None

    out: list[dict] = []
    for combo in raw_combos:
        missing: list[str] = []
        if combo["kind"] == "or":
            options: list[dict] = []
            for raw_option in combo["options"]:
                parts = [p for p in (build_part(codes, missing) for codes in raw_option["parts"]) if p]
                if parts:
                    options.append({"parts": parts})
            # 至少需要两个互斥选项才构成「二选一」
            if len(options) < 2:
                continue
            entry: dict = {"kind": "or", "options": options}
        else:
            parts = [p for p in (build_part(codes, missing) for codes in combo["parts"]) if p]
            # 捆绑至少需要两门课
            if len(parts) < 2:
                continue
            entry = {"kind": "and", "parts": parts}
        if missing:
            entry["unresolved"] = missing
        out.append(entry)
    return out


def _load_programs(
    course_lookup: dict[str, dict] | None = None,
    unresolved_sink: list[dict] | None = None,
) -> list[dict]:
    files = sorted(OUTPUT_DIR.rglob("requirements_*.json"))
    if not files:
        raise RuntimeError(f"未找到管线产物：{OUTPUT_DIR}")

    real_subjects, real_codes = _course_index_data()
    pool_count = 0

    programs: list[dict] = []
    origins: dict[tuple[str, str], list[str]] = {}
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        if data.get("_skipped_llm"):
            print(f"[warn] 跳过未审阅的解析产物：{f.name}")
            continue
        origins.setdefault((data["year"], data["code"]), []).append(f.name)

        groups = []
        for order, g in enumerate(data.get("groups", [])):
            existing_codes = [c.get("code", "") for c in g.get("courses", [])]
            pool = detect_pool(
                g.get("name"), g.get("note"), existing_codes, real_subjects, real_codes
            )
            if pool:
                pool_count += 1
            group = {
                "id": order,
                "name": g.get("name", ""),
                "required_credits": float(g.get("required_credits") or 0.0),
                "min_courses": g.get("min_courses"),
                "note": g.get("note"),
                "source_ref": _source_ref(g.get("source_pages"), g.get("source_ref")),
                "order_index": order,
                # 池组清空 courses（前端按 pool 从 courses.json 解析真实课程）
                "courses": []
                if pool
                else [_course_ref(c, course_lookup or {}) for c in g.get("courses", [])],
                "pool": pool,
            }
            # 互斥分支（Track / Option）标记：由 pipeline/apply_branches.py 事后补写，
            # 非分支组不带这四个键（保持 JSON 体积与 diff 干净）
            if g.get("branch"):
                group["branch"] = g["branch"]
                group["branch_kind"] = g.get("branch_kind")
                group["branch_optional"] = bool(g.get("branch_optional", True))
                group["parent_branch"] = g.get("parent_branch")
            # OR 组合（二选一 / 多选一）：由官方 Note 确定性解析，非组合组不写该键
            combos = _build_combos(
                g.get("note"),
                group["courses"],
                course_lookup or {},
                group["name"],
                unresolved_sink,
                data["year"],
                data["code"],
            )
            if combos:
                group["combos"] = combos
            groups.append(group)

        programs.append(
            {
                "year": data["year"],
                "code": data["code"],
                "title": data.get("title", ""),
                "total_required_credits": float(data.get("total_required_credits") or 0.0),
                "source_pdf": _normalize_source_pdf(data.get("source_pdf")),
                "uncertain": data.get("uncertain", []) or [],
                "groups": groups,
            }
        )
    # (year, code) 是方案的唯一键：重复会让后写的文件静默覆盖前一个，
    # 直接表现为「少了几份方案」，必须在此处就报错而不是等网页上看出来
    duplicated = {k: v for k, v in origins.items() if len(v) > 1}
    if duplicated:
        detail = "; ".join(
            f"{y}/{c} 来自 {', '.join(names)}" for (y, c), names in sorted(duplicated.items())
        )
        raise RuntimeError(f"存在重复的 (学年, 专业代码) 产物：{detail}")

    programs.sort(key=lambda p: (p["year"], p["code"]))
    return programs


def _load_courses() -> list[dict]:
    conn = sqlite3.connect(f"file:{SOURCE_DB}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT code, title, credits, prerequisites, offered_semesters "
            "FROM courses ORDER BY code"
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "code": r[0],
            "title": r[1],
            "credits": r[2],
            "prerequisites": r[3],
            "offered_semesters": r[4],
        }
        for r in rows
    ]


def _branches_of(program: dict) -> list[str]:
    """该方案的一级分支名（去重、按出现顺序）。"""
    names: list[str] = []
    for g in program["groups"]:
        name = g.get("branch")
        if name and name not in names:
            names.append(name)
    return names


def _build_index(programs: list[dict]) -> list[dict]:
    """首屏元信息：不含 groups / uncertain 全文，控制在几十 KB。"""
    out = []
    for p in programs:
        branches = _branches_of(p)
        out.append(
            {
                "year": p["year"],
                "code": p["code"],
                "title": p["title"],
                "total_required_credits": p["total_required_credits"],
                "source_pdf": p["source_pdf"],
                "group_count": len(p["groups"]),
                "course_count": sum(len(g["courses"]) for g in p["groups"]),
                "uncertain_count": len(p["uncertain"]),
                # 含互斥分支（Track / Option）的方案需要先让用户选方向，否则学分口径失真
                "has_branches": bool(branches),
                "branch_count": len(branches),
            }
        )
    return out


def _build_course_index(programs: list[dict]) -> dict[str, dict]:
    """反向索引：课程码 → {total: 出现总次数, items: 最多 MAX_INDEX_PER_COURSE 条}。

    保留 total 是为了让 UI 能如实告知「共 N 处引用，仅列出前 X 条」，
    而不是让用户误以为这门课只被这么几个方案要求。
    """
    items: dict[str, list[dict]] = {}
    totals: dict[str, int] = {}
    for p in programs:
        for g in p["groups"]:
            for c in g["courses"]:
                code = (c["code"] or "").upper().strip()
                if not code:
                    continue
                totals[code] = totals.get(code, 0) + 1
                bucket = items.setdefault(code, [])
                if len(bucket) < MAX_INDEX_PER_COURSE:
                    item = {
                        "year": p["year"],
                        "code": p["code"],
                        "group": g["name"],
                        "credits": c["credits"],
                    }
                    # 只在该课属于某个互斥分支时带上 branch，非分支组不写（省体积）
                    if g.get("branch"):
                        item["branch"] = g["branch"]
                    bucket.append(item)
    truncated = [c for c, n in totals.items() if n > MAX_INDEX_PER_COURSE]
    if truncated:
        print(
            f"[info] {len(truncated)} 个课程码引用数超过 {MAX_INDEX_PER_COURSE} 条，"
            f"反向索引已截断（保留真实总数）"
        )
    return {
        code: {"total": totals[code], "items": items[code]}
        for code in sorted(items)
    }


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def _years_of(programs: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for p in programs:
        counts[p["year"]] = counts.get(p["year"], 0) + 1
    return dict(sorted(counts.items()))


def _write_combo_report(unresolved: list[dict]) -> None:
    """把未被识别的 OR 句式写成人工校对清单（CI 只 warning，不阻塞）。"""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 未识别的 OR 组合句式（人工校对）",
        "",
        f"共 {len(unresolved)} 条。以下 Note 含 OR 但解析器判定为语义不明",
        "（含 AND 组合 / 散文体 or / 句式不规整），已保留官方说明原文，未参与学分核算。",
        "如需纳入二选一口径，请人工确认后扩展 scripts/combo_rules.py 的规则表。",
        "",
    ]
    for item in unresolved:
        lines.append(f"## {item['year']} {item['code']} — {item['group']}")
        lines.append("")
        lines.append("```")
        lines.append(item["note"])
        lines.append("```")
        lines.append("")
    (REPORTS_DIR / "combos_unparsed.md").write_text("\n".join(lines), encoding="utf-8")


def _write_symbol_report() -> None:
    """符号语法（`+` / `/` / one of / 小写 or）识别结果抽样清单：便于人工抽查误判。"""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 符号语法识别出的组合（人工抽查）",
        "",
        f"共 {len(SYMBOL_COMBOS)} 条。这些组合不是用官方常见的大写 `OR` / `AND` 写成，",
        "而是 `+`（且）、`/`（或）、`one of`（择一）或相邻课号间的小写 `or`。",
        "该语法族覆盖面更广、误判风险也更高，建议抽查下方清单；",
        "确认有误时请扩展 scripts/combo_rules.py 的散文黑名单或其单测用例。",
        "",
    ]
    for item in SYMBOL_COMBOS:
        lines.append(f"## {item['year']} {item['code']} — {item['group']}")
        lines.append("")
        lines.append("```")
        lines.append(item["note"])
        lines.append("```")
        lines.append("")
    (REPORTS_DIR / "combos_parsed.md").write_text("\n".join(lines), encoding="utf-8")


def export() -> int:
    programs = _load_programs(_course_lookup(), UNRESOLVED_COMBOS)
    courses = _load_courses()

    pool_total = sum(
        1 for p in programs for g in p["groups"] if g.get("pool")
    )
    if pool_total:
        print(f"[ok] 识别开放式层级池组 {pool_total} 个（单学科 N000-level or above）")

    combo_total = sum(1 for p in programs for g in p["groups"] if g.get("combos"))
    if combo_total:
        print(f"[ok] 识别 OR 组合（二选一）组 {combo_total} 个")
    # 两份报告都无条件下写：否则上一轮的旧报告会残留，误导人工校对
    _write_combo_report(UNRESOLVED_COMBOS)
    _write_symbol_report()
    if UNRESOLVED_COMBOS:
        print(
            f"[warn] {len(UNRESOLVED_COMBOS)} 条 OR 句式未识别，"
            f"已写入 pipeline/reports/combos_unparsed.md（保留官方说明原文）"
        )
        # GitHub Actions 注解：提示但不阻断（未识别只影响展示，不影响正确性）
        print(f"::warning::{len(UNRESOLVED_COMBOS)} 条 OR 组合句式未识别，见 combos_unparsed.md")
    else:
        print("[ok] 所有含组合运算符的 Note 均已解析（combos_unparsed.md 为空）")

    print(
        f"[info] {len(SYMBOL_COMBOS)} 条组合来自符号语法（+ / one of / 小写 or），"
        f"已写入 pipeline/reports/combos_parsed.md 供抽查"
    )

    if PROGRAMS_DIR.exists():
        for stale in PROGRAMS_DIR.glob("*.json"):
            stale.unlink()
    else:
        PROGRAMS_DIR.mkdir(parents=True, exist_ok=True)

    index = _build_index(programs)
    course_index = _build_course_index(programs)
    meta = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "program_count": len(programs),
        "course_count": len(courses),
        "course_index_count": len(course_index),
        "years": _years_of(programs),
    }

    _write_json(DATA_DIR / "index.json", index)
    _write_json(DATA_DIR / "courses.json", courses)
    _write_json(DATA_DIR / "course_index.json", course_index)
    _write_json(DATA_DIR / "meta.json", meta)
    for p in programs:
        _write_json(
            PROGRAMS_DIR / f"{p['year']}_{p['code']}.json",
            {
                "program": {
                    "year": p["year"],
                    "code": p["code"],
                    "title": p["title"],
                    "total_required_credits": p["total_required_credits"],
                    "source_pdf": p["source_pdf"],
                    "uncertain": p["uncertain"],
                },
                "groups": p["groups"],
            },
        )

    for name, size in [
        ("index.json", (DATA_DIR / "index.json").stat().st_size),
        ("courses.json", (DATA_DIR / "courses.json").stat().st_size),
        ("course_index.json", (DATA_DIR / "course_index.json").stat().st_size),
    ]:
        print(f"[ok] {name}: {size / 1024:.0f} KB")
    print(
        f"[ok] programs/: {len(programs)} 份 · years={meta['years']} · "
        f"courses={len(courses)} · 反向索引={len(course_index)} 个课程码"
    )
    return 0


def _check_branches(p: dict, groups: list[dict], errors: list[str]) -> None:
    """分支（Track / Option）归属完整性：每个分支至少一组、父分支必须存在、层级不自环。"""
    names = {g.get("branch") for g in groups if g.get("branch")}
    for g in groups:
        branch = g.get("branch")
        if not branch:
            continue
        if g.get("branch_kind") not in ("track", "option"):
            errors.append(f"{p['year']} {p['code']} 组「{g['name']}」branch_kind 非法：{g.get('branch_kind')}")
        parent = g.get("parent_branch")
        if parent and parent not in names:
            errors.append(f"{p['year']} {p['code']} 组「{g['name']}」的父分支「{parent}」本方案不存在")
        if parent and parent == branch:
            errors.append(f"{p['year']} {p['code']} 分支「{branch}」的父分支指向自身")
    if p.get("has_branches") != bool(names):
        errors.append(f"{p['year']} {p['code']} index.has_branches 与要求树不一致")


def check() -> int:
    """校验已导出的产物：数量断言 + 抽样完整性（CI 用，任一不符非零退出）。"""
    errors: list[str] = []
    warnings: list[str] = []

    def load(name: str):
        path = DATA_DIR / name
        if not path.exists():
            errors.append(f"缺少产物 {path}")
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    index = load("index.json")
    courses = load("courses.json")
    course_index = load("course_index.json")
    meta = load("meta.json")

    sources = sorted(OUTPUT_DIR.rglob("requirements_*.json"))
    if len(sources) != EXPECTED_PROGRAMS:
        errors.append(f"管线产物 {len(sources)} 份，期望 {EXPECTED_PROGRAMS} 份")

    # 产物完整性断言：源头不得有 credits 缺失 / name 占位（空或等于课号）。
    # 导出层虽有兜底（见 _course_ref），但源头残缺会让「0 学分」「课号当课名」静默流入前端，
    # 故在此硬门禁，防止人工补录再次漏填。
    missing_credits: list[str] = []
    placeholder_names: list[str] = []
    for src in sources:
        data = json.loads(src.read_text(encoding="utf-8"))
        if data.get("_skipped_llm"):
            continue
        for g in data.get("groups", []):
            for c in g.get("courses", []):
                code = c.get("code", "")
                if c.get("credits") is None:
                    missing_credits.append(f"{src.name} {code}")
                name = (c.get("name") or "").strip()
                if not name or name == code:
                    placeholder_names.append(f"{src.name} {code}")
    if missing_credits:
        errors.append(
            f"{len(missing_credits)} 门课 credits 缺失，例如 {missing_credits[:3]}"
        )
    if placeholder_names:
        errors.append(
            f"{len(placeholder_names)} 门课 name 占位（空/等于课号），例如 {placeholder_names[:3]}"
        )

    if index is not None:
        if len(index) != EXPECTED_PROGRAMS:
            errors.append(f"index.json {len(index)} 条，期望 {EXPECTED_PROGRAMS} 条")
        keys = [(p["year"], p["code"]) for p in index]
        if len(set(keys)) != len(keys):
            errors.append("index.json 存在重复的 (学年, 专业代码)")
        by_year: dict[str, int] = {}
        for p in index:
            by_year[p["year"]] = by_year.get(p["year"], 0) + 1
        for y in EXPECTED_YEARS:
            if by_year.get(y, 0) == 0:
                errors.append(f"缺少学年 {y}")
        for p in index:
            if p.get("group_count", 0) == 0:
                warnings.append(f"{p['year']} {p['code']} 没有要求组")

    if courses is not None and len(courses) != EXPECTED_COURSES:
        errors.append(f"courses.json {len(courses)} 门，期望 {EXPECTED_COURSES} 门")

    if index is not None:
        missing = []
        for p in index:
            path = PROGRAMS_DIR / f"{p['year']}_{p['code']}.json"
            if not path.exists():
                missing.append(path.name)
                continue
            tree = json.loads(path.read_text(encoding="utf-8"))
            groups = tree.get("groups")
            if not isinstance(groups, list) or not groups:
                warnings.append(f"{p['year']} {p['code']} 要求树为空")
                continue
            _check_branches(p, groups, errors)
        if missing:
            errors.append(f"缺少 {len(missing)} 份方案产物，例如 {missing[:3]}")

    if course_index is not None and not course_index:
        errors.append("course_index.json 为空")

    if meta is not None:
        print(
            f"[info] meta: 生成于 {meta.get('generated_at')} · "
            f"programs={meta.get('program_count')} · courses={meta.get('course_count')} · "
            f"years={meta.get('years')}"
        )

    if index is not None:
        branch_programs = sum(1 for p in index if p.get("has_branches"))
        print(f"[info] 含互斥分支（Track / Option）的方案 {branch_programs} 份")

    for w in warnings:
        print(f"[warn] {w}")
    for e in errors:
        print(f"[error] {e}")

    if errors:
        print(f"[fail] 数据校验未通过（{len(errors)} 项）")
        return 1
    print(f"[ok] 数据校验通过（{len(warnings)} 条警告）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="只校验已导出产物，不写文件")
    args = ap.parse_args()
    return check() if args.check else export()


if __name__ == "__main__":
    sys.exit(main())

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
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "pipeline" / "output"
SOURCE_DB = ROOT / "courses.db"
DATA_DIR = ROOT / "frontend" / "public" / "data"
PROGRAMS_DIR = DATA_DIR / "programs"

# 期望值：CI 用它们断言「网站能看到全部内容」
EXPECTED_PROGRAMS = 255
EXPECTED_COURSES = 1144
EXPECTED_YEARS = ["2023-24", "2024-25", "2025-26", "2026-27"]
# 单个课程码的反向索引条目上限（超出截断并记录真实总数，避免通识类课程撑爆文件）
MAX_INDEX_PER_COURSE = 50


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


def _load_programs() -> list[dict]:
    files = sorted(OUTPUT_DIR.glob("requirements_*.json"))
    if not files:
        raise RuntimeError(f"未找到管线产物：{OUTPUT_DIR}")

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
            groups.append(
                {
                    "id": order,
                    "name": g.get("name", ""),
                    "required_credits": float(g.get("required_credits") or 0.0),
                    "min_courses": g.get("min_courses"),
                    "note": g.get("note"),
                    "source_ref": _source_ref(g.get("source_pages"), g.get("source_ref")),
                    "order_index": order,
                    "courses": [
                        {
                            "code": c.get("code", ""),
                            "name": c.get("name", ""),
                            "credits": float(c.get("credits") or 0.0),
                            "areas": c.get("areas", []) or [],
                        }
                        for c in g.get("courses", [])
                    ],
                }
            )

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


def _build_index(programs: list[dict]) -> list[dict]:
    """首屏元信息：不含 groups / uncertain 全文，控制在几十 KB。"""
    return [
        {
            "year": p["year"],
            "code": p["code"],
            "title": p["title"],
            "total_required_credits": p["total_required_credits"],
            "source_pdf": p["source_pdf"],
            "group_count": len(p["groups"]),
            "course_count": sum(len(g["courses"]) for g in p["groups"]),
            "uncertain_count": len(p["uncertain"]),
        }
        for p in programs
    ]


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
                    bucket.append(
                        {
                            "year": p["year"],
                            "code": p["code"],
                            "group": g["name"],
                            "credits": c["credits"],
                        }
                    )
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


def export() -> int:
    programs = _load_programs()
    courses = _load_courses()

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

    sources = sorted(OUTPUT_DIR.glob("requirements_*.json"))
    if len(sources) != EXPECTED_PROGRAMS:
        errors.append(f"管线产物 {len(sources)} 份，期望 {EXPECTED_PROGRAMS} 份")

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
            if not isinstance(tree.get("groups"), list) or not tree["groups"]:
                warnings.append(f"{p['year']} {p['code']} 要求树为空")
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

"""学分一致性核对：requirements.json（LLM 抽取） vs courses.db（官方课程库）。

courses.db 的 credits 为 VARCHAR（如 "3 Credit(s)"、"4-6 Credit(s)"、""），
统一容错解析为 float（范围取下限）后逐课对比。
差异报告输出 JSON + Markdown 供人工校对，不自动修改数据。
"""

import json
import re
from pathlib import Path
from typing import Optional

from schemas import ExtractionResult

CREDITS_RE = re.compile(r"(\d+(?:\.\d+)?)")
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def normalize_code(code: str) -> str:
    return re.sub(r"\s+", "", code).upper()


def parse_credits(raw: Optional[str]) -> Optional[float]:
    """容错解析学分字符串：'3 Credit(s)' -> 3.0，'4-6 Credit(s)' -> 4.0。"""
    if not raw:
        return None
    m = CREDITS_RE.search(raw)
    return float(m.group(1)) if m else None


def load_official_courses(db_path: Path) -> dict[str, dict]:
    """读取原始 courses.db（只读），返回 normalized_code -> {title, credits}。"""
    import sqlite3

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT code, title, credits FROM courses"
        ).fetchall()
    finally:
        conn.close()
    return {
        normalize_code(code): {"title": title, "credits": parse_credits(credits), "credits_raw": credits}
        for code, title, credits in rows
    }


def crosscheck(result: ExtractionResult, db_path: Path) -> dict:
    """逐课核对，返回差异报告 dict（可直接 dump 为 JSON）。"""
    official = load_official_courses(db_path)
    issues: list[dict] = []
    total_extracted_courses = 0

    for group in result.groups:
        for course in group.courses:
            total_extracted_courses += 1
            norm = normalize_code(course.code)
            entry = official.get(norm)
            if entry is None:
                issues.append(
                    {
                        "type": "missing_in_courses_db",
                        "group": group.name,
                        "code": course.code,
                        "llm_name": course.name,
                        "llm_credits": course.credits,
                        "source_pages": course.source_pages,
                    }
                )
                continue
            db_credits = entry["credits"]
            if db_credits is None:
                issues.append(
                    {
                        "type": "unparseable_credits_in_db",
                        "group": group.name,
                        "code": course.code,
                        "db_credits_raw": entry["credits_raw"],
                        "llm_credits": course.credits,
                    }
                )
            elif abs(db_credits - course.credits) > 1e-6:
                issues.append(
                    {
                        "type": "credits_mismatch",
                        "group": group.name,
                        "code": course.code,
                        "db_credits": db_credits,
                        "llm_credits": course.credits,
                        "source_pages": course.source_pages,
                    }
                )

    mismatch_count = sum(1 for i in issues if i["type"] == "credits_mismatch")
    return {
        "year": result.year,
        "code": result.code,
        "title": result.title,
        "checked_courses": total_extracted_courses,
        "issue_count": len(issues),
        "credits_mismatch": mismatch_count,
        "issues": issues,
        "groups": [
            {
                "name": g.name,
                "required_credits": g.required_credits,
                "course_count": len(g.courses),
                "source_pages": g.source_pages,
            }
            for g in result.groups
        ],
    }


def write_report(report: dict, reports_dir: Path) -> tuple[Path, Path]:
    """输出 JSON + Markdown 双格式差异报告，返回文件路径。"""
    reports_dir.mkdir(parents=True, exist_ok=True)
    base = f"crosscheck_{report['year']}_{report['code']}"

    json_path = reports_dir / f"{base}.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# Crosscheck 报告：{report['title']}（{report['year']} / {report['code']}）",
        "",
        f"- 核对课程数：{report['checked_courses']}",
        f"- 差异条目：{report['issue_count']}（其中学分不一致 {report['credits_mismatch']}）",
        "",
    ]
    if report["issues"]:
        lines += ["| 类型 | 组 | 课号 | LLM学分 | DB学分 | 页码 |", "|---|---|---|---|---|---|"]
        for i in report["issues"]:
            lines.append(
                f"| {i['type']} | {i.get('group', '')} | {i.get('code', '')} "
                f"| {i.get('llm_credits', '')} | {i.get('db_credits', i.get('db_credits_raw', ''))} "
                f"| {i.get('source_pages', '')} |"
            )
    else:
        lines.append("全部课程学分与 courses.db 一致。")

    md_path = reports_dir / f"{base}.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path

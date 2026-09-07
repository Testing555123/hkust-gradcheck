"""导入审阅后的 requirements.json（pipeline 产物）到 grad.db。

用法：
    .venv\\Scripts\\python.exe backend\\scripts\\seed.py            # 导入 output/ 全部产物
    .venv\\Scripts\\python.exe backend\\scripts\\seed.py --dry-run  # 只校验不写库

导入策略：按 (year, code) 重建式写入（先删旧记录再插入），保证幂等；
courses 表（原课程库）绝不动。
"""

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import Session, select  # noqa: E402

from app.db import engine, init_db  # noqa: E402
from app.models import Program, RequirementCourse, RequirementGroup  # noqa: E402
from app.schemas import ProgramInput  # noqa: E402

OUTPUT_DIR = PROJECT_ROOT / "pipeline" / "output"


def _normalize_groups(data: dict) -> list[dict]:
    """把 pipeline 的 source_pages（list[int]）转为 source_ref 字符串保留页码引用。"""
    groups = []
    for g in data.get("groups", []):
        g = dict(g)
        pages = g.pop("source_pages", None)
        if pages and not g.get("source_ref"):
            g["source_ref"] = ", ".join(f"p.{p}" for p in pages)
        g["courses"] = [
            {
                "code": c["code"],
                "name": c["name"],
                "credits": c["credits"],
                "areas": c.get("areas", []),
            }
            for c in g.get("courses", [])
        ]
        groups.append(g)
    return groups


def seed_from_dict(data: dict, session: Session) -> int:
    """把一份 requirements dict 重建式写入数据库，返回 program.id。"""
    tree = ProgramInput.model_validate(
        {
            "year": data["year"],
            "code": data["code"],
            "title": data["title"],
            "total_required_credits": data.get("total_required_credits", 0.0),
            "source_pdf": data.get("source_pdf"),
            "groups": _normalize_groups(data),
        }
    )

    old = session.exec(
        select(Program).where(Program.year == tree.year, Program.code == tree.code)
    ).first()
    if old is not None:
        for g in session.exec(
            select(RequirementGroup).where(RequirementGroup.program_id == old.id)
        ).all():
            for c in session.exec(
                select(RequirementCourse).where(RequirementCourse.group_id == g.id)
            ).all():
                session.delete(c)
            session.delete(g)
        session.delete(old)
        session.flush()

    program = Program(
        year=tree.year,
        code=tree.code,
        title=tree.title,
        total_required_credits=tree.total_required_credits,
        source_pdf=tree.source_pdf,
    )
    session.add(program)
    session.flush()

    for order, g in enumerate(tree.groups):
        group = RequirementGroup(
            program_id=program.id,
            name=g.name,
            required_credits=g.required_credits,
            min_courses=g.min_courses,
            note=g.note,
            source_ref=g.source_ref,
            order_index=order,
        )
        session.add(group)
        session.flush()
        for c_order, c in enumerate(g.courses):
            session.add(
                RequirementCourse(
                    group_id=group.id,
                    code=c.code,
                    name=c.name,
                    credits=c.credits,
                    area="; ".join(c.areas) if c.areas else None,
                    source_ref=None,
                    order_index=c_order,
                )
            )
    session.flush()
    return program.id  # type: ignore[return-value]


def seed_all(dry_run: bool = False) -> int:
    init_db()
    files = sorted(OUTPUT_DIR.glob("requirements_*.json"))
    if not files:
        print(f"未找到产物：{OUTPUT_DIR}")
        return 0

    imported = 0
    with Session(engine) as session:
        for f in files:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("_skipped_llm"):
                print(f"[skip] 未审阅的解析产物: {f.name}")
                continue
            pid = seed_from_dict(data, session)
            print(f"[ok] {data['year']} {data['code']}: {data['title']} (program_id={pid})")
            imported += 1
        if dry_run:
            session.rollback()
            print("--dry-run：已回滚，未写库")
        else:
            session.commit()
    return imported


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    seed_all(dry_run=args.dry_run)

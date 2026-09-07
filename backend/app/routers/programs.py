from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models import Program, RequirementCourse, RequirementGroup
from app.schemas import CourseRef, ProgramOut, ProgramTree, RequirementGroupOut

router = APIRouter(tags=["programs"])


@router.get("/programs", response_model=list[ProgramOut])
def list_programs(session: Session = Depends(get_session)) -> list[ProgramOut]:
    """列出所有已导入的培养方案（按学年倒序、专业代码排序）。"""
    rows = session.exec(
        select(Program).order_by(Program.year.desc(), Program.code)
    ).all()
    return [ProgramOut.model_validate(r) for r in rows]


@router.get("/programs/{year}/{code}", response_model=ProgramTree)
def get_program_tree(
    year: str, code: str, session: Session = Depends(get_session)
) -> ProgramTree:
    """返回某学年某专业的完整毕业要求树（含各组课程与页码引用）。"""
    program = session.exec(
        select(Program).where(Program.year == year, Program.code == code)
    ).first()
    if program is None:
        raise HTTPException(status_code=404, detail=f"Program {year}/{code} not found")

    groups = session.exec(
        select(RequirementGroup)
        .where(RequirementGroup.program_id == program.id)
        .order_by(RequirementGroup.order_index)
    ).all()

    group_ids = [g.id for g in groups if g.id is not None]
    courses_by_group: dict[int, list[RequirementCourse]] = {}
    if group_ids:
        req_courses = session.exec(
            select(RequirementCourse)
            .where(RequirementCourse.group_id.in_(group_ids))  # type: ignore[attr-defined]
            .order_by(RequirementCourse.order_index)
        ).all()
        for rc in req_courses:
            courses_by_group.setdefault(rc.group_id, []).append(rc)

    group_outs = [
        RequirementGroupOut(
            id=g.id or 0,
            name=g.name,
            required_credits=g.required_credits,
            min_courses=g.min_courses,
            note=g.note,
            source_ref=g.source_ref,
            order_index=g.order_index,
            courses=[
                CourseRef(
                    code=c.code,
                    name=c.name,
                    credits=c.credits,
                    areas=[a.strip() for a in (c.area or "").split(";") if a.strip()],
                )
                for c in courses_by_group.get(g.id or 0, [])
            ],
        )
        for g in groups
    ]
    return ProgramTree(
        program=ProgramOut.model_validate(program), groups=group_outs
    )

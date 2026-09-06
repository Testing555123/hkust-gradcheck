from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, or_, select

from app.db import get_session
from app.models import Course
from app.schemas import CourseOut

router = APIRouter(tags=["courses"])


@router.get("/courses", response_model=list[CourseOut])
def list_courses(
    search: Optional[str] = Query(default=None, max_length=100),
    limit: int = Query(default=200, ge=1, le=2000),
    session: Session = Depends(get_session),
) -> list[CourseOut]:
    """课程列表，支持按课号/名称模糊搜索。"""
    stmt = select(Course).order_by(Course.code)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Course.code.ilike(pattern), Course.title.ilike(pattern))
        )
    rows = session.exec(stmt.limit(limit)).all()
    return [CourseOut.model_validate(r) for r in rows]


@router.get("/courses/by-codes", response_model=list[CourseOut])
def get_courses_by_codes(
    codes: str = Query(..., max_length=4000),
    session: Session = Depends(get_session),
) -> list[CourseOut]:
    """按课号批量取课程详情（逗号分隔），供前端补全学分/先修信息。"""
    code_list = [c.strip().upper() for c in codes.split(",") if c.strip()]
    if not code_list:
        return []
    rows = session.exec(select(Course).where(Course.code.in_(code_list))).all()  # type: ignore[attr-defined]
    return [CourseOut.model_validate(r) for r in rows]

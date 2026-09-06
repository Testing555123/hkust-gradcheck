from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CourseRef(BaseModel):
    """要求组下的课程引用（pipeline 产出与 API 共用结构）。"""

    code: str
    name: str
    credits: float
    areas: list[str] = []


class RequirementGroupOut(BaseModel):
    id: int
    name: str
    required_credits: float
    min_courses: Optional[int] = None
    source_ref: Optional[str] = None
    order_index: int = 0
    courses: list[CourseRef] = []


class ProgramOut(BaseModel):
    year: str
    code: str
    title: str
    total_required_credits: float
    source_pdf: Optional[str] = None

    model_config = {"from_attributes": True}


class GroupInput(BaseModel):
    """pipeline requirements.json 中单个要求组的输入模型（无 id）。"""

    name: str
    required_credits: float
    min_courses: Optional[int] = None
    source_ref: Optional[str] = None
    courses: list[CourseRef] = []


class ProgramInput(BaseModel):
    """seed 导入的输入模型（对应 pipeline 产物，无数据库 id）。"""

    year: str
    code: str
    title: str
    total_required_credits: float = 0.0
    source_pdf: Optional[str] = None
    groups: list[GroupInput] = []


class ProgramTree(BaseModel):
    """培养方案 + 毕业要求树（前端主数据）。"""

    program: ProgramOut
    groups: list[RequirementGroupOut] = []


class CourseOut(BaseModel):
    """courses.db 中的课程条目（浏览/搜索用）。"""

    id: int
    code: str
    title: str
    credits: Optional[str] = None
    prerequisites: Optional[str] = None
    offered_semesters: Optional[str] = None
    updated_at: datetime

    model_config = {"from_attributes": True}

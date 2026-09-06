from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Course(SQLModel, table=True):
    """映射已有 courses.db 中的 courses 表（1144 门课），不修改其结构。"""

    __tablename__ = "courses"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(max_length=20, index=True)
    title: str = Field(max_length=200)
    credits: Optional[str] = Field(default=None, max_length=10)
    description: Optional[str] = None
    prerequisites: Optional[str] = None
    offered_semesters: Optional[str] = Field(default=None, max_length=100)
    updated_at: datetime


class Program(SQLModel, table=True):
    """一个学年下的一个主修培养方案（如 2024-25 的 COMP）。"""

    __tablename__ = "programs"

    id: Optional[int] = Field(default=None, primary_key=True)
    year: str = Field(max_length=10, index=True)  # 如 "2024-25"
    code: str = Field(max_length=20, index=True)  # 如 "COMP"
    title: str = Field(max_length=200)
    total_required_credits: float = Field(default=0.0)
    source_pdf: Optional[str] = Field(default=None, max_length=300)


class RequirementGroup(SQLModel, table=True):
    """毕业要求分组（如「专业核心课」），隶属某个 Program。"""

    __tablename__ = "requirement_groups"

    id: Optional[int] = Field(default=None, primary_key=True)
    program_id: int = Field(foreign_key="programs.id", index=True)
    name: str = Field(max_length=200)
    required_credits: float = Field(default=0.0)
    min_courses: Optional[int] = Field(default=None)
    source_ref: Optional[str] = Field(default=None, max_length=100)  # PDF 页码引用
    order_index: int = Field(default=0)


class RequirementCourse(SQLModel, table=True):
    """要求组下的课程条目，code 与 courses 表对齐。"""

    __tablename__ = "requirement_courses"

    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="requirement_groups.id", index=True)
    code: str = Field(max_length=20, index=True)
    name: str = Field(max_length=200)
    credits: float = Field(default=0.0)
    area: Optional[str] = Field(default=None, max_length=400)  # 分号分隔多 Area；非选修为空
    source_ref: Optional[str] = Field(default=None, max_length=100)
    order_index: int = Field(default=0)

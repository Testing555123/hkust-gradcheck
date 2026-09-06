"""LLM 结构化抽取的 Pydantic Schema（管线内部契约，最终映射到 backend 表）。"""

from typing import Optional

from pydantic import BaseModel, Field


class ExtractedCourse(BaseModel):
    """要求组下的单门课程（或课程选项）。"""

    code: str = Field(description="课程代码，规范化为无空格大写，如 COMP1023")
    name: str = Field(description="课程名称")
    credits: float = Field(description="学分数；若为范围如 4-6 取下限")
    credits_raw: str = Field(default="", description="PDF 原文学分表述，如 '4-6'")
    areas: list[str] = Field(
        default_factory=list,
        description="选修课所属 Area 名称（可多个，如 ['Artificial Intelligence', 'Theory']）；非选修或未分类为空",
    )
    source_pages: list[int] = Field(default_factory=list, description="PDF 页码出处")


class ExtractedGroup(BaseModel):
    """毕业要求分组，如 'Required Courses' / 'Engineering Fundamental Course(s)'。"""

    name: str
    required_credits: float = Field(description="该组要求获得的学分数（取自 'Credit(s) attained'）")
    required_credits_raw: str = Field(default="", description="PDF 原文要求表述")
    note: str = Field(default="", description="组合规则原文，如 '(A OR B) AND C'")
    courses: list[ExtractedCourse] = Field(default_factory=list)
    source_pages: list[int] = Field(default_factory=list)


class ExtractionResult(BaseModel):
    """单份培养方案 PDF 的完整抽取结果（requirements.json 的结构）。"""

    year: str
    code: str
    title: str
    total_required_credits: float = Field(default=0.0)
    groups: list[ExtractedGroup] = Field(default_factory=list)
    uncertain: list[str] = Field(
        default_factory=list, description="LLM 不确定、建议人工复核的条目说明"
    )

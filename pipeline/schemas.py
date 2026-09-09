"""LLM 结构化抽取的 Pydantic Schema（管线内部契约，最终固化为静态 JSON 供前端读取）。"""

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
    """毕业要求分组，如 'Required Courses' / 'Engineering Fundamental Course(s)'。

    同一主修内部可能存在若干**互斥分支方向**（官方只用 Track / Option 两种叫法，
    学生择一修读、各分支学分下限不同）。组名本身常常就是
    '<名> Track|Option Required Course(s)'，但 LLM 抽取阶段不负责识别它——
    分支标记由 pipeline/apply_branches.py 事后确定性补写（见 branch_rules.py）。
    因此这四个字段：校验时接受（读已有产物），序列化时排除（抽取产物保持干净）。
    """

    name: str
    required_credits: float = Field(description="该组要求获得的学分数（取自 'Credit(s) attained'）")
    required_credits_raw: str = Field(default="", description="PDF 原文要求表述")
    note: str = Field(default="", description="组合规则原文，如 '(A OR B) AND C'")
    courses: list[ExtractedCourse] = Field(default_factory=list)
    source_pages: list[int] = Field(default_factory=list)
    branch: Optional[str] = Field(
        default=None, exclude=True, description="所属互斥分支名，如 'Applied Mathematics Track'"
    )
    branch_kind: Optional[str] = Field(
        default=None, exclude=True, description="分支官方叫法：track | option"
    )
    branch_optional: bool = Field(
        default=True, exclude=True, description="true = 可不选（不选则不计入分母）"
    )
    parent_branch: Optional[str] = Field(
        default=None, exclude=True, description="二级分支的父分支名，如 CHEM 的 Core Chemistry Track"
    )


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

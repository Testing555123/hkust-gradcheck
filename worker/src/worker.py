"""毕业要求查询与学分核查 API — Cloudflare Workers 版（FastAPI + D1）。

与 backend/（本地 uvicorn + SQLite 文件版）端点行为一致：
- GET /api/health
- GET /api/programs
- GET /api/programs/{year}/{code}
- GET /api/courses?search=&limit=
- GET /api/courses/by-codes?codes=

数据层：SQLModel → D1 绑定（request.scope["env"].DB，异步 prepare/bind/all）。
前端静态产物由 Workers Static Assets 托管（见 wrangler.jsonc assets 配置），
非 /api 路径 SPA fallback 到 index.html，全部同源。
"""

from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="毕业要求查询与学分核查 API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _db(request: Request):
    """从 ASGI scope 取 D1 绑定（wrangler.jsonc 中 binding: DB）。"""
    return request.scope["env"].DB


# ============ 响应模型（与 backend/app/schemas.py 保持一致） ============


class CourseRef(BaseModel):
    """要求组下的课程引用。"""

    code: str
    name: str
    credits: float
    areas: list[str] = []


class RequirementGroupOut(BaseModel):
    id: int
    name: str
    required_credits: float
    min_courses: Optional[int] = None
    note: Optional[str] = None
    source_ref: Optional[str] = None
    order_index: int = 0
    courses: list[CourseRef] = []


class ProgramOut(BaseModel):
    year: str
    code: str
    title: str
    total_required_credits: float
    source_pdf: Optional[str] = None


class ProgramTree(BaseModel):
    """培养方案 + 毕业要求树（前端主数据）。"""

    program: ProgramOut
    groups: list[RequirementGroupOut] = []


class CourseOut(BaseModel):
    """courses 表课程条目（浏览/搜索用）。"""

    id: int
    code: str
    title: str
    credits: Optional[str] = None
    prerequisites: Optional[str] = None
    offered_semesters: Optional[str] = None
    updated_at: datetime


def _row_dict(row) -> dict:
    """D1 行（JS 对象代理）转 Python dict。"""
    return row.to_py() if hasattr(row, "to_py") else dict(row)


def _iso(dt: Optional[str]) -> Optional[str]:
    """SQLite 时间字符串 "YYYY-MM-DD HH:MM:SS" → ISO "T" 分隔，便于 pydantic 解析。"""
    if dt is None:
        return None
    return str(dt).replace(" ", "T")


# ============ 端点 ============


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/programs", response_model=list[ProgramOut])
async def list_programs(request: Request) -> list[dict]:
    """列出所有已导入的培养方案（按学年倒序、专业代码排序）。"""
    res = await _db(request).prepare(
        "SELECT year, code, title, total_required_credits, source_pdf "
        "FROM programs ORDER BY year DESC, code"
    ).all()
    return [_row_dict(r) for r in res.results]


@app.get("/api/programs/{year}/{code}", response_model=ProgramTree)
async def get_program_tree(year: str, code: str, request: Request) -> dict:
    """返回某学年某专业的完整毕业要求树（含各组课程与页码引用）。"""
    db = _db(request)
    program = (
        await db.prepare(
            "SELECT id, year, code, title, total_required_credits, source_pdf "
            "FROM programs WHERE year = ? AND code = ?"
        )
        .bind(year, code)
        .first()
    )
    if program is None:
        raise HTTPException(status_code=404, detail=f"Program {year}/{code} not found")

    groups_res = await db.prepare(
        "SELECT id, name, required_credits, min_courses, note, source_ref, order_index "
        "FROM requirement_groups WHERE program_id = ? ORDER BY order_index"
    ).bind(program.id).all()

    courses_res = await db.prepare(
        "SELECT rc.group_id, rc.code, rc.name, rc.credits, rc.area "
        "FROM requirement_courses rc "
        "JOIN requirement_groups g ON rc.group_id = g.id "
        "WHERE g.program_id = ? ORDER BY rc.order_index"
    ).bind(program.id).all()

    courses_by_group: dict[int, list[CourseRef]] = {}
    for r in courses_res.results:
        rc = _row_dict(r)
        areas = [a.strip() for a in (rc.get("area") or "").split(";") if a.strip()]
        courses_by_group.setdefault(rc["group_id"], []).append(
            CourseRef(
                code=rc["code"],
                name=rc["name"],
                credits=rc["credits"],
                areas=areas,
            )
        )

    group_outs = [
        RequirementGroupOut(
            **_row_dict(g),
            courses=courses_by_group.get(g.id, []),
        )
        for g in groups_res.results
    ]
    return ProgramTree(
        program=ProgramOut(**_row_dict(program)),
        groups=group_outs,
    ).model_dump()


_COURSE_COLS = (
    "id, code, title, credits, prerequisites, offered_semesters, updated_at"
)


@app.get("/api/courses", response_model=list[CourseOut])
async def list_courses(
    request: Request,
    search: Optional[str] = Query(default=None, max_length=100),
    limit: int = Query(default=200, ge=1, le=2000),
) -> list[dict]:
    """课程列表，支持按课号/名称模糊搜索。"""
    db = _db(request)
    stmt = f"SELECT {_COURSE_COLS} FROM courses"
    bind: list = []
    if search:
        pattern = f"%{search.strip()}%"
        stmt += " WHERE LOWER(code) LIKE ? OR LOWER(title) LIKE ?"
        bind = [pattern.lower(), pattern.lower()]
    stmt += " ORDER BY code LIMIT ?"
    bind.append(limit)
    res = await db.prepare(stmt).bind(*bind).all()
    rows = []
    for r in res.results:
        d = _row_dict(r)
        d["updated_at"] = _iso(d.get("updated_at"))
        rows.append(d)
    return rows


@app.get("/api/courses/by-codes", response_model=list[CourseOut])
async def get_courses_by_codes(request: Request, codes: str = Query(..., max_length=4000)) -> list[dict]:
    """按课号批量取课程详情（逗号分隔），供前端补全学分/先修信息。"""
    code_list = [c.strip().upper() for c in codes.split(",") if c.strip()]
    if not code_list:
        return []
    placeholders = ", ".join("?" for _ in code_list)
    res = await (
        _db(request)
        .prepare(f"SELECT {_COURSE_COLS} FROM courses WHERE UPPER(code) IN ({placeholders})")
        .bind(*code_list)
        .all()
    )
    rows = []
    for r in res.results:
        d = _row_dict(r)
        d["updated_at"] = _iso(d.get("updated_at"))
        rows.append(d)
    return rows


try:
    import asgi  # Cloudflare Python Workers 运行时提供

    Default = asgi.entrypoint(app)
except ModuleNotFoundError:
    # 本地 pytest / uvicorn 调试环境无 workers 运行时，直接导出 ASGI app
    Default = app  # type: ignore[assignment]

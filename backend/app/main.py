from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.db import init_db
from app.routers import courses, programs


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="毕业要求查询与学分核查 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(programs.router, prefix=settings.api_prefix)
app.include_router(courses.router, prefix=settings.api_prefix)


@app.get(f"{settings.api_prefix}/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ============ 前端静态托管（容器部署用） ============
# static 目录存在时（Docker 镜像内 COPY 至 /app/static），
# FastAPI 同源托管前端 SPA：/assets 走 StaticFiles（带 ETag 缓存头），
# 其余非 /api 的 GET 路径 fallback 到 index.html（客户端路由兜底）。
# 本地开发（无 static 目录）自动跳过，行为与原来完全一致。
# 注意：/docs、/openapi.json、/api/* 路由注册在先，优先级高于下面的 catch-all。
_STATIC_DIR: Path = settings.static_dir

if _STATIC_DIR.is_dir():
    _ASSETS_DIR = _STATIC_DIR / "assets"

    if _ASSETS_DIR.is_dir():
        app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith(settings.api_prefix.lstrip("/")):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (_STATIC_DIR / full_path).resolve()
        # 防目录穿越：仅返回 static 目录内的真实文件，其余一律回 index.html
        if (
            full_path
            and candidate.is_file()
            and candidate.is_relative_to(_STATIC_DIR.resolve())
        ):
            return FileResponse(candidate)
        return FileResponse(_STATIC_DIR / "index.html")

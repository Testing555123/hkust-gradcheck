from pathlib import Path

from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    """应用配置。

    courses.db 是用户爬虫产出的原始课程库（1144 门课，文件带只读属性）。
    backend 不直接写原库：首次启动时复制为可写工作副本 grad.db，
    毕业要求相关表建在副本中。原库更新后删除副本即可重新同步。
    """

    source_db_path: Path = PROJECT_ROOT / "courses.db"
    db_path: Path = BACKEND_DIR / "data" / "grad.db"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    api_prefix: str = "/api"

    model_config = {"env_prefix": "GRAD_"}


settings = Settings()

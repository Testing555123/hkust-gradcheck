import os
import shutil
import stat

from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    echo=False,
    connect_args={"check_same_thread": False},
)


def _ensure_db_file() -> None:
    """确保可写工作副本存在：不存在则从原始 courses.db 复制并去只读。"""
    if settings.db_path.exists():
        return
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(settings.source_db_path, settings.db_path)
    os.chmod(settings.db_path, stat.S_IWRITE | stat.S_IREAD)


def init_db() -> None:
    """建表（CREATE TABLE IF NOT EXISTS 语义）+ 轻量列迁移。

    只新增毕业要求相关表，不触碰副本中已有的 courses 表结构。
    """
    import app.models  # noqa: F401  确保模型注册到 SQLModel.metadata

    _ensure_db_file()
    SQLModel.metadata.create_all(engine)

    # 轻量迁移：旧库的 requirement_courses 缺少 area 列（create_all 不加列）
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(requirement_courses)")}
        if "area" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE requirement_courses ADD COLUMN area VARCHAR(400)"
            )
            conn.commit()


def get_session():
    with Session(engine) as session:
        yield session

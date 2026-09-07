"""从数据底座（courses.db + pipeline/output/requirements_*.json）生成 D1 初始化 SQL。

流程：
1. 在临时目录初始化一个 grad.db（复用 backend 的 init_db + seed 逻辑，
   通过 GRAD_DB_PATH 环境变量重定向路径，不污染本地 backend/data/）
2. 导出 4 张表（courses / programs / requirement_groups / requirement_courses）
   为幂等 SQL（DROP IF EXISTS + CREATE + INSERT）
3. 写入 worker/db_init.sql，供 `wrangler d1 execute --file` 导入 D1

用法（需项目根 .venv，依赖 fastapi/sqlmodel/pydantic/pydantic-settings）：
    .venv/bin/python scripts/export_d1_sql.py
"""

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "worker" / "db_init.sql"
TABLES = ["courses", "programs", "requirement_groups", "requirement_courses"]


def _build_temp_db() -> Path:
    """在临时目录构建完整 grad.db（courses 复制 + requirement 表 seed）。"""
    tmp_dir = Path(tempfile.mkdtemp(prefix="grad-d1-export-"))
    db_path = tmp_dir / "grad.db"

    env = os.environ.copy()
    env["GRAD_DB_PATH"] = str(db_path)
    env["GRAD_SOURCE_DB_PATH"] = str(ROOT / "courses.db")
    env["PYTHONIOENCODING"] = "utf-8"

    result = subprocess.run(
        [sys.executable, str(ROOT / "backend" / "scripts" / "seed.py")],
        env=env,
        check=False,
    )
    if result.returncode != 0 or not db_path.exists():
        raise RuntimeError("seed.py 执行失败，无法生成临时 grad.db")
    return db_path


def _quote(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def _dump(db_path: Path) -> list[str]:
    conn = sqlite3.connect(db_path)
    try:
        lines = [
            "-- 本文件由 scripts/export_d1_sql.py 自动生成，勿手工编辑。",
            f"-- 生成时间：{datetime_now()}",
            "",
        ]
        for table in TABLES:
            row = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if row is None:
                raise RuntimeError(f"临时库中缺少表 {table}，init_db/seed 未按预期工作")
            lines.append(f"DROP TABLE IF EXISTS {table};")
            lines.append(row[0] + ";")

            cur = conn.execute(f"SELECT * FROM {table}")
            cols = [d[0] for d in cur.description]
            count = 0
            for values in cur.fetchall():
                lines.append(
                    f"INSERT INTO {table} ({', '.join(cols)}) "
                    f"VALUES ({', '.join(_quote(v) for v in values)});"
                )
                count += 1
            lines.append(f"-- {table}: {count} rows")
            lines.append("")
            print(f"[ok] {table}: {count} rows")
        return lines
    finally:
        conn.close()


def datetime_now() -> str:
    from datetime import datetime

    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def main() -> None:
    db_path = _build_temp_db()
    lines = _dump(db_path)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"[ok] 已写入 {OUTPUT}（{OUTPUT.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()

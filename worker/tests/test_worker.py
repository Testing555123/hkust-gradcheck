"""worker/src/worker.py 的本地单元测试：Fake D1（本地 sqlite3）+ 全端点对拍。

D1 即 SQLite，SQL 方言一致；本测试验证 SQL 正确性与 Python 映射逻辑。
真实运行时行为（workerd/pyodide）由 Cloudflare 部署后的冒烟验证兜底。

运行（项目根 .venv，需 fastapi/pytest/httpx）：
    .venv/bin/python -m pytest worker/tests -q
"""

import sqlite3
import sys
from pathlib import Path

import pytest

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR / "src"))

# 在导入 worker 前，注入 fake asgi 模块（本地无 workers 运行时）
import types  # noqa: E402

fake_asgi = types.ModuleType("asgi")
fake_asgi.entrypoint = lambda app: app
sys.modules.setdefault("asgi", fake_asgi)

from fastapi.testclient import TestClient  # noqa: E402

import worker  # noqa: E402  noqa: E402

DB_PATH = WORKER_DIR / "db_init.sql"


# ============ Fake D1：sqlite3 之上的 prepare/bind/all/first/run ============


class Row:
    """模拟 D1 返回的 JS 对象行：属性访问 + to_py()。"""

    def __init__(self, d: dict):
        self._d = d

    def __getattr__(self, name):
        try:
            return self._d[name]
        except KeyError as e:
            raise AttributeError(name) from e

    def to_py(self) -> dict:
        return dict(self._d)


class Stmt:
    def __init__(self, conn: sqlite3.Connection, sql: str):
        self._conn = conn
        self._sql = sql
        self._params: tuple = ()

    def bind(self, *params):
        self._params = params
        return self

    def _execute(self):
        return self._conn.execute(self._sql, self._params)

    async def all(self):
        cur = self._execute()
        cols = [d[0] for d in cur.description]
        results = [Row(dict(zip(cols, row))) for row in cur.fetchall()]
        return D1Result(results)

    async def first(self):
        cur = self._execute()
        cols = [d[0] for d in cur.description]
        row = cur.fetchone()
        return Row(dict(zip(cols, row))) if row else None

    async def run(self):
        self._execute()
        return {}


class D1Result:
    """模拟 D1 查询结果对象（属性访问 .results，与真实 D1 一致）。"""

    def __init__(self, results: list):
        self.results = results


class FakeDB:
    """实现 worker.py 用到的 D1 最小接口。"""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def prepare(self, sql: str) -> Stmt:
        return Stmt(self._conn, sql)


class EnvMiddleware:
    """纯 ASGI 中间件：向 scope 注入 env.DB（模拟 workerd 行为）。"""

    def __init__(self, app, db: FakeDB):
        self.app = app
        self.db = db

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            scope["env"] = type("Env", (), {"DB": self.db})()
        await self.app(scope, receive, send)


@pytest.fixture(scope="module")
def client():
    assert DB_PATH.exists(), "worker/db_init.sql 不存在，先运行 scripts/export_d1_sql.py"
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript(DB_PATH.read_text(encoding="utf-8"))
    app = EnvMiddleware(worker.app, FakeDB(conn))
    return TestClient(app)


# ============ 端点测试（与 backend/tests/test_api.py 对齐） ============


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_list_programs(client):
    programs = client.get("/api/programs").json()
    assert isinstance(programs, list) and len(programs) >= 1
    p = programs[0]
    assert set(p) == {"year", "code", "title", "total_required_credits", "source_pdf"}


def test_program_tree(client):
    programs = client.get("/api/programs").json()
    p = programs[0]
    tree = client.get(f"/api/programs/{p['year']}/{p['code']}")
    assert tree.status_code == 200
    body = tree.json()
    assert body["program"]["code"] == p["code"]
    assert isinstance(body["groups"], list) and len(body["groups"]) >= 1
    g = body["groups"][0]
    assert {"id", "name", "required_credits", "order_index", "courses"} <= set(g)
    for c in g["courses"]:
        assert {"code", "name", "credits", "areas"} <= set(c)


def test_program_tree_404(client):
    r = client.get("/api/programs/1999-00/NOPE")
    assert r.status_code == 404


def test_list_courses(client):
    rows = client.get("/api/courses", params={"limit": 5}).json()
    assert len(rows) == 5
    for r in rows:
        assert {"id", "code", "title", "credits", "updated_at"} <= set(r)


def test_search_courses(client):
    rows = client.get("/api/courses", params={"search": "python", "limit": 50}).json()
    assert len(rows) >= 1
    assert all(
        "python" in r["title"].lower() or "python" in r["code"].lower() for r in rows
    )


def test_courses_by_codes(client):
    rows = client.get("/api/courses/by-codes", params={"codes": "comp1021, comp1023"}).json()
    codes = {r["code"] for r in rows}
    assert "COMP1021" in codes
    assert all(r["code"].isupper() or not r["code"] for r in rows)


def test_courses_by_codes_empty(client):
    assert client.get("/api/courses/by-codes", params={"codes": ""}).json() == []

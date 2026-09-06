"""API 接口测试：跑在临时 SQLite 副本上，验证 courses 读取、seed 往返与要求树接口。"""

from fastapi.testclient import TestClient

from app.db import init_db
from app.main import app
from scripts.seed import seed_from_dict
from sqlmodel import Session

client = TestClient(app)


def setup_module(module) -> None:
    init_db()


def test_health() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_courses_search() -> None:
    resp = client.get("/api/courses", params={"search": "COMP1023"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert data[0]["code"].upper() == "COMP1023"


def test_courses_by_codes() -> None:
    resp = client.get("/api/courses/by-codes", params={"codes": "COMP1023,MATH1013"})
    assert resp.status_code == 200
    codes = {c["code"].upper() for c in resp.json()}
    assert {"COMP1023", "MATH1013"} <= codes


def test_program_tree_seed_roundtrip() -> None:
    sample = {
        "year": "2026-27",
        "code": "TST1",
        "title": "BTest in Testing",
        "total_required_credits": 120,
        "source_pdf": "test.pdf",
        "groups": [
            {
                "name": "Required Courses",
                "required_credits": 30,
                "min_courses": None,
                "source_pages": [1, 2],
                "courses": [
                    {
                        "code": "COMP1023",
                        "name": "Introduction to Python Programming",
                        "credits": 3,
                        "areas": ["Artificial Intelligence"],
                        "source_pages": [1],
                    }
                ],
            }
        ],
    }
    from app.db import engine

    with Session(engine) as session:
        pid = seed_from_dict(sample, session)
        session.commit()
    assert pid is not None

    resp = client.get("/api/programs/2026-27/TST1")
    assert resp.status_code == 200
    tree = resp.json()
    assert tree["program"]["title"] == "BTest in Testing"
    assert tree["groups"][0]["required_credits"] == 30
    assert tree["groups"][0]["courses"][0]["code"] == "COMP1023"

    resp_list = client.get("/api/programs")
    assert resp_list.status_code == 200
    assert any(p["code"] == "TST1" for p in resp_list.json())


def test_program_404() -> None:
    resp = client.get("/api/programs/1999-00/NOPE")
    assert resp.status_code == 404

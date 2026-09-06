"""crosscheck 纯函数单测：学分容错解析、课号规范化、差异识别。"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from crosscheck import crosscheck, normalize_code, parse_credits  # noqa: E402
from schemas import ExtractedCourse, ExtractedGroup, ExtractionResult  # noqa: E402


def test_normalize_code() -> None:
    assert normalize_code("comp 1023") == "COMP1023"
    assert normalize_code("COMP1023") == "COMP1023"


def test_parse_credits() -> None:
    assert parse_credits("3 Credit(s)") == 3.0
    assert parse_credits("4-6 Credit(s)") == 4.0
    assert parse_credits("") is None
    assert parse_credits(None) is None


def _make_result(courses: list[tuple[str, float]]) -> ExtractionResult:
    return ExtractionResult(
        year="2026-27",
        code="COMP",
        title="BEng in Computer Science",
        groups=[
            ExtractedGroup(
                name="Required",
                required_credits=30,
                courses=[
                    ExtractedCourse(code=c, name=f"Course {c}", credits=v) for c, v in courses
                ],
            )
        ],
    )


def test_crosscheck_mix() -> None:
    # COMP1023(3) 在 courses.db 中存在且学分一致；XXXX0000 不存在
    result = _make_result([("COMP 1023", 3.0), ("XXXX0000", 2.0)])
    real_db = PIPELINE_DIR.parent / "courses.db"
    report = crosscheck(result, real_db)
    assert report["checked_courses"] == 2
    types = {i["type"] for i in report["issues"]}
    assert "missing_in_courses_db" in types
    codes = {i["code"] for i in report["issues"]}
    assert "XXXX0000" in codes

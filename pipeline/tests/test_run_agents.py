"""run_agents 集成测试：验证三段编排真的串起来了。

用 pymupdf 现场生成一份单页 PDF 作为 fixture（不依赖仓库外的真实 PDF），
并把两个 pass 的 LLM 调用替换成固定返回值——这里要验证的是**接线**，
不是 LLM 的抽取质量。所以断言落在三份产物的内容与一致上。
"""

import json
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

import pytest  # noqa: E402

from agents import run_agents  # noqa: E402
from agents.schemas import Evidence, PassBResult  # noqa: E402
from schemas import ExtractedCourse, ExtractedGroup, ExtractionResult  # noqa: E402


def _make_pdf(path: Path) -> None:
    import fitz  # pymupdf

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Required Courses")
    page.insert_text((72, 100), "COMP 1023 Introduction to Computer Science 3 Credit(s)")
    page.insert_text((72, 120), "COMP 1024 Data Structures 3 Credit(s)")
    doc.save(str(path))
    doc.close()


def _pass_a(year: str, code: str) -> ExtractionResult:
    return ExtractionResult(
        year=year,
        code=code,
        title="BEng in Computer Science",
        groups=[
            ExtractedGroup(
                name="Required Courses",
                required_credits=6,
                courses=[
                    ExtractedCourse(code="COMP1023", name="Intro", credits=3,
                                    credits_raw="3 Credit(s)"),
                    ExtractedCourse(code="COMP1024", name="DS", credits=3,
                                    credits_raw="3 Credit(s)"),
                ],
            )
        ],
    )


def _pass_b(year: str, code: str) -> PassBResult:
    """第二 pass 同意第一门课，第二门课学分不同（4 而非 3），制造一个冲突。"""
    result = ExtractionResult(
        year=year,
        code=code,
        title="",
        groups=[
            ExtractedGroup(
                name="Required Courses",
                required_credits=6,
                courses=[
                    ExtractedCourse(code="COMP1023", name="Intro", credits=3),
                    ExtractedCourse(code="COMP1024", name="DS", credits=4),
                ],
            )
        ],
    )
    return PassBResult(
        result=result,
        evidence={
            "groups[0]": Evidence(chunk_id="c0", page=1, char_start=0, char_end=10),
            "groups[0].courses[0]": Evidence(chunk_id="c1", page=1, char_start=20, char_end=40),
            "groups[0].courses[1]": Evidence(chunk_id="c2", page=1, char_start=41, char_end=60),
        },
    )


@pytest.fixture()
def pdf(tmp_path: Path) -> Path:
    p = tmp_path / "COMP.pdf"
    _make_pdf(p)
    return p


def test_run_writes_all_three_artifacts(pdf: Path, tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "agent-out"
    monkeypatch.setattr(
        run_agents, "extract_requirements", lambda doc, year, code: _pass_a(year, code)
    )
    monkeypatch.setattr(
        run_agents, "run_pass_b", lambda doc, year, code, key: _pass_b(year, code)
    )
    # 没有 LLM key 时 judge 为 None，冲突会走「不决」分支——正是想要的
    monkeypatch.setattr(run_agents, "make_llm_judge", lambda text: None)

    rc = run_agents.run("2026-27", "COMP", pdf, "pymupdf", True, out, "", "llm")
    assert rc == 0

    target = out / "2026-27" / "COMP"
    assert (target / "requirements.json").exists()
    assert (target / "chunks.json").exists()
    assert (target / "review.json").exists()


def test_chunks_are_written_with_pages_and_ids(pdf: Path, tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "agent-out"
    monkeypatch.setattr(
        run_agents, "extract_requirements", lambda doc, year, code: _pass_a(year, code)
    )
    monkeypatch.setattr(run_agents, "run_pass_b", lambda doc, year, code, key: _pass_b(year, code))
    monkeypatch.setattr(run_agents, "make_llm_judge", lambda text: None)

    run_agents.run("2026-27", "COMP", pdf, "pymupdf", True, out, "", "llm")
    data = json.loads((out / "2026-27" / "COMP" / "chunks.json").read_text(encoding="utf-8"))

    assert data["program_key"] == "2026-27/COMP"
    assert data["chunks"], "必须有切片，否则规则层无法溯源"
    assert all(c["page"] == 1 for c in data["chunks"])
    assert len({c["chunk_id"] for c in data["chunks"]}) == len(data["chunks"])


def test_conflict_is_recorded_as_needs_human_review(
    pdf: Path, tmp_path: Path, monkeypatch
) -> None:
    out = tmp_path / "agent-out"
    monkeypatch.setattr(
        run_agents, "extract_requirements", lambda doc, year, code: _pass_a(year, code)
    )
    monkeypatch.setattr(run_agents, "run_pass_b", lambda doc, year, code, key: _pass_b(year, code))
    monkeypatch.setattr(run_agents, "make_llm_judge", lambda text: None)

    run_agents.run("2026-27", "COMP", pdf, "pymupdf", True, out, "", "llm")
    review = json.loads((out / "2026-27" / "COMP" / "review.json").read_text(encoding="utf-8"))

    assert review["needs_human_review"] is True
    assert "groups[0].courses[1].credits" in review["arbitration"]["unresolved"]


def test_skipping_pass_b_produces_no_diff_noise(
    pdf: Path, tmp_path: Path, monkeypatch
) -> None:
    """第二 pass 缺席时不应把第一 pass 的全部条目报成 missing——没有第二意见就不该比对。"""
    out = tmp_path / "agent-out"
    monkeypatch.setattr(
        run_agents, "extract_requirements", lambda doc, year, code: _pass_a(year, code)
    )

    run_agents.run("2026-27", "COMP", pdf, "pymupdf", False, out, "", "llm")
    review = json.loads((out / "2026-27" / "COMP" / "review.json").read_text(encoding="utf-8"))

    assert review["diff"] == []
    assert review["needs_human_review"] is False


def test_source_pdf_is_relative_not_absolute(pdf: Path, tmp_path: Path, monkeypatch) -> None:
    """gates.ts 会拒绝绝对路径，产物里的 source_pdf 必须是相对路径。"""
    out = tmp_path / "agent-out"
    monkeypatch.setattr(
        run_agents, "extract_requirements", lambda doc, year, code: _pass_a(year, code)
    )
    monkeypatch.setattr(run_agents, "run_pass_b", lambda doc, year, code, key: _pass_b(year, code))
    monkeypatch.setattr(run_agents, "make_llm_judge", lambda text: None)

    run_agents.run("2026-27", "COMP", pdf, "pymupdf", True, out, "", "llm")
    req = json.loads((out / "2026-27" / "COMP" / "requirements.json").read_text(encoding="utf-8"))

    # tmp_path 不在 PROJECT_ROOT 下，应退化为文件名而不是把绝对路径写进去
    assert not req["source_pdf"].startswith(("C:", "/"))

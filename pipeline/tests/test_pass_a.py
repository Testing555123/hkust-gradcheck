"""Pass A 复用既有产物 的单测。

动机：pipeline/output 下已有 255 份人工校对过的抽取产物。
没有 LLM key 时把它们当 Pass A，整条核对链路照样能每天跑；
有 key 时自动切回真正的双 pass。
"""

import json
import os
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from agents import run_agents  # noqa: E402
from schemas import ExtractionResult  # noqa: E402


def _seed_artifact(root: Path, category: str, year: str, code: str, payload: dict) -> Path:
    target = root / category / code
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"requirements_{year}_{code}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def _payload(year: str, code: str) -> dict:
    return {
        "year": year,
        "code": code,
        "title": "BEng in Computer Science",
        "total_required_credits": 30,
        "groups": [
            {
                "name": "Required Courses",
                "required_credits": 30,
                "courses": [{"code": "COMP1023", "name": "Intro", "credits": 3}],
            }
        ],
        "uncertain": [],
    }


def test_load_existing_result_reads_the_artifact(tmp_path: Path) -> None:
    _seed_artifact(tmp_path, "major", "2026-27", "COMP", _payload("2026-27", "COMP"))

    found = run_agents.load_existing_result(tmp_path, "2026-27", "COMP")

    assert isinstance(found, ExtractionResult)
    assert found.code == "COMP"
    assert found.groups[0].courses[0].code == "COMP1023"


def test_load_existing_result_returns_none_when_absent(tmp_path: Path) -> None:
    assert run_agents.load_existing_result(tmp_path, "2026-27", "NOPE") is None


def test_load_existing_result_finds_prefixed_categories(tmp_path: Path) -> None:
    """MINOR-/EXTM-/SREQ- 前缀要走各自的目录，不能都往 major 找。"""
    _seed_artifact(tmp_path, "minor", "2026-27", "MINOR-CS", _payload("2026-27", "MINOR-CS"))
    _seed_artifact(tmp_path, "extended", "2026-27", "EXTM-AI", _payload("2026-27", "EXTM-AI"))

    assert run_agents.load_existing_result(tmp_path, "2026-27", "MINOR-CS") is not None
    assert run_agents.load_existing_result(tmp_path, "2026-27", "EXTM-AI") is not None


def test_explicit_existing_wins_over_llm(monkeypatch) -> None:
    monkeypatch.setenv("GRAD_LLM_API_KEY", "sk-test")
    assert run_agents.resolve_pass_a_source("existing") == "existing"


def test_explicit_llm_wins_over_auto(monkeypatch) -> None:
    monkeypatch.delenv("GRAD_LLM_API_KEY", raising=False)
    assert run_agents.resolve_pass_a_source("llm") == "llm"


def test_auto_falls_back_to_existing_without_key(monkeypatch) -> None:
    monkeypatch.delenv("GRAD_LLM_API_KEY", raising=False)
    assert run_agents.resolve_pass_a_source("auto") == "existing"


def test_auto_uses_llm_when_key_present(monkeypatch) -> None:
    monkeypatch.setenv("GRAD_LLM_API_KEY", "sk-test")
    assert run_agents.resolve_pass_a_source("auto") == "llm"


def test_unknown_source_is_rejected() -> None:
    import pytest

    with pytest.raises(ValueError):
        run_agents.resolve_pass_a_source("bogus")


def test_real_repo_has_existing_artifacts() -> None:
    """仓库里确实有存量产物——这条断言防止上面的复用逻辑建立在空想上。"""
    assert run_agents.load_existing_result(run_agents.OUTPUT_DIR, "2024-25", "COMP") is not None

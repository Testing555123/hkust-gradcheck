"""同步腳本單測：文件建構、衍生欄位、不變量校驗、資料版本。

這些測試刻意不碰資料庫 —— 只要輸入輸出正確，upsert 本身是標準的 bulk_write，
風險極低；真正容易出錯的是「欄位怎麼從產物對應到文件」與「不變量是否有效」。
"""

import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from sync_to_atlas import (  # noqa: E402
    build_course_documents,
    build_program_document,
    check_invariants,
    collect_areas,
    compute_data_version,
    derive_level,
    derive_subject,
    kind_of,
    parse_credits_value,
    validate_groups,
)


# ── 衍生欄位 ────────────────────────────────────────────────────────────────
def test_kind_of_prefixes():
    assert kind_of("MATH") == "major"
    assert kind_of("EXTM-AI") == "extm"
    assert kind_of("MINOR-BUS") == "minor"
    assert kind_of("SREQ-SENG") == "school"
    # 前缀大小写必须完全相符，否则会被误判为主修
    assert kind_of("extm-AI") == "major"


def test_derive_subject():
    assert derive_subject("COMP1021") == "COMP"
    assert derive_subject("COMP1022P") == "COMP"
    assert derive_subject("comp1021") == "COMP"
    assert derive_subject("1234") is None
    assert derive_subject("AB12") is None
    assert derive_subject("") is None


def test_derive_level():
    assert derive_level("COMP1021") == 1021
    assert derive_level("COMP1022P") == 1022
    assert derive_level("LANG100") == 100
    assert derive_level("ABCD") is None
    assert derive_level("MATH12345") is None


def test_derive_subject_and_level_for_range_codes():
    """官方課程庫存在範圍課號（ENGG2991-2993 / SBMT2100-2110），
    必須取起首課號的學科與級別，否則這些課會從學科／級別篩選中消失。"""
    assert derive_subject("ENGG2991-2993") == "ENGG"
    assert derive_level("ENGG2991-2993") == 2991
    assert derive_subject("SBMT2100-2110") == "SBMT"
    assert derive_level("SBMT2100-2110") == 2100
    assert derive_subject("HUMA2000-2001") == "HUMA"


def test_parse_credits_value_takes_lower_bound():
    assert parse_credits_value("3 Credit(s)") == 3.0
    assert parse_credits_value("4-6 Credit(s)") == 4.0
    assert parse_credits_value("0 Credit(s)") == 0.0
    assert parse_credits_value("") is None
    assert parse_credits_value(None) is None
    assert parse_credits_value("Nil") is None


def test_collect_areas_is_sorted_and_unique():
    groups = [
        {"courses": [{"code": "A", "areas": ["Science", "Technology"]}]},
        {"courses": [{"code": "B", "areas": ["Science"]}, {"code": "C", "areas": []}]},
    ]
    assert collect_areas(groups) == ["Science", "Technology"]


# ── 文件建構 ────────────────────────────────────────────────────────────────
INDEX_ENTRY = {
    "year": "2024-25",
    "code": "EXTM-AI",
    "title": "Extended Major in Artificial Intelligence",
    "total_required_credits": 22.0,
    "source_pdf": "unpress_pdf/major/2024-25/EXTM_AI.pdf",
    "group_count": 2,
    "course_count": 3,
    "uncertain_count": 1,
    "has_branches": True,
    "branch_count": 1,
}

PROGRAM_FILE = {
    "program": {
        "year": "2024-25",
        "code": "EXTM-AI",
        "title": "Extended Major in Artificial Intelligence",
        "total_required_credits": 22.0,
        "source_pdf": "unpress_pdf/major/2024-25/EXTM_AI.pdf",
        "uncertain": ["第 3 页表格跨页，学分可能低估"],
    },
    "groups": [
        {
            "id": 0,
            "name": "Core required",
            "required_credits": 12.0,
            "min_courses": None,
            "source_ref": "p.1",
            "note": "Note: COMP 2011 AND COMP 2012",
            "order_index": 0,
            "courses": [
                {"code": "COMP2011", "name": "Programming", "credits": 4.0, "areas": ["Science"]}
            ],
            "combos": [
                {
                    "kind": "and",
                    "parts": [
                        {"courses": [{"code": "COMP2011"}]},
                        {"courses": [{"code": "COMP2012"}]},
                    ],
                }
            ],
            "pool": None,
            "branch": None,
            "branch_kind": None,
            "branch_optional": True,
            "parent_branch": None,
        },
        {
            "id": 1,
            "name": "Elective(s)",
            "required_credits": 10.0,
            "order_index": 1,
            "courses": [],
            "pool": {"subject": "COMP", "minLevel": 3000},
        },
    ],
}


def test_build_program_document_derives_kind_and_keeps_fields():
    doc = build_program_document(INDEX_ENTRY, PROGRAM_FILE, "abcdef1234567890")

    # index.json 没有 kind 字段，必须由代码前缀推导
    assert doc["kind"] == "extm"
    assert doc["data_version"] == "abcdef1234567890"
    assert doc["year"] == "2024-25"
    assert doc["code"] == "EXTM-AI"
    assert doc["group_count"] == 2
    assert doc["has_branches"] is True
    assert len(doc["groups"]) == 2
    assert doc["uncertain"] == ["第 3 页表格跨页，学分可能低估"]
    # 组合、层级池等结构字段原样保留（无损搬运）
    assert doc["groups"][0]["combos"][0]["kind"] == "and"
    assert doc["groups"][1]["pool"] == {"subject": "COMP", "minLevel": 3000}


def test_build_program_document_defaults_missing_optional_fields():
    entry = {
        k: v
        for k, v in INDEX_ENTRY.items()
        if k not in ("source_pdf", "uncertain_count", "code")
    }
    entry["code"] = "MATH"
    file_obj = {
        "program": {"year": "2024-25", "code": "MATH", "title": "M", "total_required_credits": 3.0}
    }
    doc = build_program_document(entry, file_obj, "deadbeefdeadbeef")

    assert doc["kind"] == "major"
    assert doc["source_pdf"] is None
    assert doc["uncertain"] == []
    assert doc["groups"] == []


COURSES = [
    {
        "code": "COMP1021",
        "title": "Introduction to Computer Science",
        "credits": "3 Credit(s)",
        "prerequisites": "",
        "offered_semesters": "Fall",
    },
    {
        "code": "LANG100",
        "title": "Language",
        "credits": None,
        "prerequisites": None,
        "offered_semesters": None,
    },
]

COURSE_INDEX = {
    "COMP1021": {"total": 42, "items": [{"year": "2023-24", "code": "MAEC", "group": "ACCT", "credits": 3.0}]},
}


def test_build_course_documents_derives_numeric_fields():
    docs = build_course_documents(
        COURSES, COURSE_INDEX, {"COMP1021": ["Science"]}, "abcdef1234567890"
    )
    by_code = {d["code"]: d for d in docs}

    assert by_code["COMP1021"]["credits_value"] == 3.0
    assert by_code["COMP1021"]["subject"] == "COMP"
    assert by_code["COMP1021"]["level"] == 1021
    assert by_code["COMP1021"]["areas"] == ["Science"]
    assert by_code["COMP1021"]["occurrence_count"] == 42
    assert by_code["COMP1021"]["data_version"] == "abcdef1234567890"
    # 原始欄位一字不改
    assert by_code["COMP1021"]["credits"] == "3 Credit(s)"
    assert by_code["COMP1021"]["prerequisites"] == ""

    # 缺漏資料時給安全預設值
    assert by_code["LANG100"]["credits_value"] is None
    assert by_code["LANG100"]["areas"] == []
    assert by_code["LANG100"]["occurrence_count"] == 0
    assert by_code["LANG100"]["level"] == 100


# ── 資料版本 ────────────────────────────────────────────────────────────────
def test_data_version_is_stable_and_content_sensitive(tmp_path):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text('{"x": 1}', encoding="utf-8")
    b.write_text('{"y": 2}', encoding="utf-8")

    first = compute_data_version([a, b])
    second = compute_data_version([a, b])
    assert first == second
    assert len(first) == 16

    b.write_text('{"y": 3}', encoding="utf-8")
    assert compute_data_version([a, b]) != first


def test_data_version_ignores_input_order(tmp_path):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text("1", encoding="utf-8")
    b.write_text("2", encoding="utf-8")
    assert compute_data_version([a, b]) == compute_data_version([b, a])


# ── 不變量 ──────────────────────────────────────────────────────────────────
def _healthy_artifacts():
    index = [INDEX_ENTRY]
    meta = {
        "generated_at": "2026-09-12 11:22:17",
        "program_count": 1,
        "course_count": 2,
        "course_index_count": 1,
        "years": {"2024-25": 1},
    }
    program_docs = [build_program_document(INDEX_ENTRY, PROGRAM_FILE, "abcdef1234567890")]
    # 讓 group_count 與實際組數一致（INDEX_ENTRY 宣告 2 組，PROGRAM_FILE 也是 2 組）
    course_docs = build_course_documents(COURSES, COURSE_INDEX, {}, "abcdef1234567890")
    return index, meta, program_docs, course_docs


def test_check_invariants_passes_on_consistent_data():
    assert check_invariants(*_healthy_artifacts()) == []


def test_check_invariants_detects_count_mismatch():
    index, meta, program_docs, course_docs = _healthy_artifacts()
    meta = {**meta, "program_count": 99}
    errors = check_invariants(index, meta, program_docs, course_docs)
    assert any("program_count" in e for e in errors)


def test_check_invariants_detects_group_count_mismatch():
    index, meta, program_docs, course_docs = _healthy_artifacts()
    program_docs[0]["group_count"] = 7
    errors = check_invariants(index, meta, program_docs, course_docs)
    assert any("group_count" in e for e in errors)


def test_check_invariants_detects_missing_year():
    index, meta, program_docs, course_docs = _healthy_artifacts()
    meta = {**meta, "years": {}}
    errors = check_invariants(index, meta, program_docs, course_docs)
    assert any("years" in e for e in errors)


def test_validate_groups_accepts_supported_combos():
    assert validate_groups(PROGRAM_FILE["groups"], "2024-25 EXTM-AI") == []


def test_validate_groups_rejects_or_with_single_option():
    groups = [{"id": 0, "name": "g", "required_credits": 1.0, "order_index": 0, "courses": [],
               "combos": [{"kind": "or", "options": [{"parts": [{"courses": [{"code": "A"}]}]}]}]}]
    errors = validate_groups(groups, "label")
    assert any("options" in e for e in errors)


def test_validate_groups_rejects_unknown_combo_kind():
    groups = [{"id": 0, "name": "g", "required_credits": 1.0, "order_index": 0, "courses": [],
               "combos": [{"kind": "xor", "parts": []}]}]
    errors = validate_groups(groups, "label")
    assert any("kind" in e for e in errors)


def test_validate_groups_requires_core_fields():
    errors = validate_groups([{"id": 0, "courses": []}], "label")
    assert any("name" in e for e in errors)
    assert any("required_credits" in e for e in errors)

"""组合规则解析器单测：OR 链 / AND 捆绑 / 嵌套 / 散文体噪音。

保守优先：误判成组合会直接算错学分，因此「该识别的必须识别、该降级的一律降级」
两端都有断言锁定。

产出结构：
- OR：`{"kind": "or", "options": [{"parts": [[code, ...], ...]}, ...]}`
- AND：`{"kind": "and", "parts": [[code, ...], ...]}`
"""

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from combo_rules import parse_combos  # noqa: E402


# ── OR 组合：part 内选一门，option 之间互斥 ────────────────────────────────
def test_simple_pair():
    """A OR B = 两个互斥选项，各含一个 part（part 内选一门）。"""
    combos, unresolved = parse_combos("Note: MATH 2421 OR MATH 2431")
    assert combos == [
        {
            "kind": "or",
            "options": [{"parts": [["MATH2421"]]}, {"parts": [["MATH2431"]]}],
        }
    ]
    assert unresolved == []


def test_multi_line_note():
    note = (
        "Note: MATH 2421 OR MATH 2431\n"
        "Note: MATH 4424 OR MATH 4425\n"
        "Note: MATH 4993 OR MATH 4999"
    )
    combos, unresolved = parse_combos(note)
    assert [c["options"] for c in combos] == [
        [{"parts": [["MATH2421"]]}, {"parts": [["MATH2431"]]}],
        [{"parts": [["MATH4424"]]}, {"parts": [["MATH4425"]]}],
        [{"parts": [["MATH4993"]]}, {"parts": [["MATH4999"]]}],
    ]
    assert unresolved == []


def test_four_way_chain():
    combos, _ = parse_combos("Note: COMP 1021 OR COMP 1022P OR COMP 2011 OR COMP 2012H")
    assert combos == [
        {
            "kind": "or",
            "options": [
                {"parts": [["COMP1021"]]},
                {"parts": [["COMP1022P"]]},
                {"parts": [["COMP2011"]]},
                {"parts": [["COMP2012H"]]},
            ],
        }
    ]


def test_trailing_prose_still_combo():
    """四选一后跟带课号的说明文字：只取组合部分，说明文字不参与。"""
    combos, unresolved = parse_combos(
        "Note: CENG 4920 OR CENG 4930 OR CENG 4940 "
        "(Students taking the Research Option must take CENG 4940)"
    )
    assert combos == [
        {
            "kind": "or",
            "options": [
                {"parts": [["CENG4920"]]},
                {"parts": [["CENG4930"]]},
                {"parts": [["CENG4940"]]},
            ],
        }
    ]
    assert unresolved == []


def test_duplicate_code_deduped():
    combos, _ = parse_combos(
        "Note: LANG 3024 OR LANG 3027 (Students following IRE Track should take LANG 3027)"
    )
    assert combos == [
        {
            "kind": "or",
            "options": [{"parts": [["LANG3024"]]}, {"parts": [["LANG3027"]]}],
        }
    ]


# ── AND 捆绑 ────────────────────────────────────────────────────────────
def test_and_bundle_inside_or_option():
    """(COMP 2011 AND COMP 2012) OR COMP 2012H：一个选项是两门课的捆绑。"""
    combos, unresolved = parse_combos("Note: (COMP 2011 AND COMP 2012) OR COMP 2012H")
    assert combos == [
        {
            "kind": "or",
            "options": [
                {"parts": [["COMP2011"], ["COMP2012"]]},
                {"parts": [["COMP2012H"]]},
            ],
        }
    ]
    assert unresolved == []


def test_nested_or_inside_and_bundle():
    """[COMP 1991 AND (COMP 4981 OR COMP 4981H)] OR [COMP 4910]"""
    combos, _ = parse_combos(
        "Note: [COMP 1991 AND (COMP 4981 OR COMP 4981H)] OR [COMP 4910]"
    )
    assert combos == [
        {
            "kind": "or",
            "options": [
                {"parts": [["COMP1991"], ["COMP4981", "COMP4981H"]]},
                {"parts": [["COMP4910"]]},
            ],
        }
    ]


def test_top_level_and_of_or_groups():
    """[(MATH 1013 OR MATH 1023) AND (MATH 1014 OR MATH 1024)] OR [MATH 1020]"""
    combos, unresolved = parse_combos(
        "Note: [(MATH 1013 OR MATH 1023) AND (MATH 1014 OR MATH 1024)] OR [MATH 1020]"
    )
    assert combos == [
        {
            "kind": "or",
            "options": [
                {"parts": [["MATH1013", "MATH1023"], ["MATH1014", "MATH1024"]]},
                {"parts": [["MATH1020"]]},
            ],
        }
    ]
    assert unresolved == []


def test_three_way_and_of_or_groups():
    combos, _ = parse_combos(
        "Note: [(MATH 1012 OR MATH 1013 OR MATH 1023) AND (MATH 1014 OR MATH 1024)] "
        "OR [MATH 1020]"
    )
    assert combos[0]["options"][0]["parts"] == [
        ["MATH1012", "MATH1013", "MATH1023"],
        ["MATH1014", "MATH1024"],
    ]


def test_plain_and_both_required():
    """纯 AND：两门都要（学分口径本来就是这样，仅用于合并展示）。"""
    combos, unresolved = parse_combos(
        "Note: COMP 2011 AND COMP 2012 (Students who took the 5-credit COMP 2012H "
        "in 2014-15 or after may ...)"
    )
    assert combos == [{"kind": "and", "parts": [["COMP2011"], ["COMP2012"]]}]
    assert unresolved == []


# ── 噪音与降级 ──────────────────────────────────────────────────────────
def test_prose_or_is_not_a_combo():
    """散文体 or（HKDSE 免修说明）绝不能识别成组合，也不进校对清单。"""
    combos, unresolved = parse_combos(
        "Students with level 3 or above in HKDSE 1x Biology are exempted from taking LIFS 1901"
    )
    assert combos == []
    assert unresolved == []


def test_lowercase_and_is_prose():
    """小写 and 是英文连接词（Electives 描述），不是课程组合。"""
    combos, unresolved = parse_combos(
        "Chemistry Electives [Course(s) from the specified elective list, of which at "
        "least 2 courses must be at 3000-level and above]"
    )
    assert combos == []
    assert unresolved == []


def test_lowercase_and_with_codes_is_prose():
    combos, unresolved = parse_combos(
        "Students in the IRE Track should also take SCIE 3500 and SCIE 4500 as specified"
    )
    assert combos == []
    assert unresolved == []


def test_follow_one_of_the_tracks_is_prose():
    combos, _ = parse_combos(
        "Track Study: students should follow one of the tracks and complete all requirements"
    )
    assert combos == []


def test_empty_bracket_is_not_a_combo():
    """括号内是说明文字而非课号：不是组合。"""
    combos, _ = parse_combos("Note: MATH 2411 (Students taking the Research Option)")
    assert combos == []


def test_no_or_no_combo():
    assert parse_combos("Note: take any 3000-level MATH course") == ([], [])


def test_empty_note():
    assert parse_combos(None) == ([], [])
    assert parse_combos("   ") == ([], [])


def test_missing_codes_still_parsed():
    """课号不在本组 / 不在课程库也要解析出来，由导出层标记为 unresolved 选项。"""
    combos, _ = parse_combos("Note: XXXX 0000 OR MATH 2421")
    assert combos == [
        {"kind": "or", "options": [{"parts": [["XXXX0000"]]}, {"parts": [["MATH2421"]]}]}
    ]


# ── 第二语法族：`+` = AND、`/` = OR、`one of` 前缀、相邻小写 or ─────────────
def test_symbol_syntax_and_or():
    """A + B / C：/ 绑定优先于 +，即 A AND (B OR C)。"""
    combos, unresolved = parse_combos("Note: EMIA 2020 (3) + EMIA 4110 / MATH 4432 (3)")
    assert combos == [
        {
            "kind": "and",
            "parts": [["EMIA2020"], ["EMIA4110", "MATH4432"]],
        }
    ]
    assert unresolved == []


def test_one_of_choice_group():
    combos, unresolved = parse_combos(
        "Note: EMIA 2010A (0) + EMIA 2020 (3) + one of EMIA 4110 / COMP 4211 / MATH 4432 (3)"
    )
    assert combos == [
        {
            "kind": "and",
            "parts": [["EMIA2010A"], ["EMIA2020"], ["EMIA4110", "COMP4211", "MATH4432"]],
        }
    ]
    assert unresolved == []


def test_prose_prefix_skipped_and_trailing_prose_cut():
    """句首散文跳过；表达式中间遇到英文单词（capstone）即截断，句尾散文无害。"""
    note = (
        "Core required (lower-bound): EMIA 2010A (0) + EMIA 2020 (3) "
        "+ one of EMIA 4110 / COMP 4211 / MATH 4432 (3) + capstone EMIA 4990 (0) "
        "or EMIA 4991 (3) + one of COMP 2011 / COMP 2012 / COMP 2012H (4-5) "
        "+ one of COMP 2211 / COMP 3211 (3). Lower bound uses EMIA 4990 (0) and COMP 2011 (4)."
    )
    combos, _ = parse_combos(note)
    assert combos == [
        {
            "kind": "and",
            "parts": [["EMIA2010A"], ["EMIA2020"], ["EMIA4110", "COMP4211", "MATH4432"]],
        }
    ]


def test_lowercase_or_between_adjacent_codes():
    combos, unresolved = parse_combos("Note: capstone EMIA 4990 (0) or EMIA 4991 (3)")
    assert combos == [
        {
            "kind": "or",
            "options": [{"parts": [["EMIA4990"]]}, {"parts": [["EMIA4991"]]}],
        }
    ]
    assert unresolved == []


def test_lowercase_or_in_prose_not_combo():
    """`level 3 or above` / `subject and level` 这类散文不产生组合。"""
    assert parse_combos("Any 6 courses of the subject and level as specified")[0] == []
    assert parse_combos("... at 3000-level or above, of which at least 3 credits")[0] == []


def test_slash_chain_without_one_of():
    combos, _ = parse_combos("Note: PHYS 1112 / PHYS 1312")
    assert combos == [
        {
            "kind": "or",
            "options": [{"parts": [["PHYS1112"]]}, {"parts": [["PHYS1312"]]}],
        }
    ]


def test_plus_without_one_of():
    combos, _ = parse_combos("Note: COMP 2011 + COMP 2012")
    assert combos == [{"kind": "and", "parts": [["COMP2011"], ["COMP2012"]]}]


def test_credit_parens_ignored():
    """括号学分（含 (0 cr) / (4-5)）不参与结构。"""
    combos, _ = parse_combos("Note: EMIA 2010A (0 cr) + EMIA 2020 (3 credits) + MATH 4432 (4-5)")
    assert combos == [
        {
            "kind": "and",
            "parts": [["EMIA2010A"], ["EMIA2020"], ["MATH4432"]],
        }
    ]


def test_skipped_bare_numbers_do_not_merge_groups():
    """`ECON 2103/2113/2123; FINA 2203/2303` 里 2113/2123 不是课号，
    不能让两条互不相干的斜杠链连成一条（否则三个小组会被并成一个择一）。"""
    combos, _ = parse_combos(
        "No more than one course within each of these groups may be counted: "
        "ECON 2103/2113/2123; FINA 2203/2303; MGMT 1110/2110."
    )
    assert combos == []


def test_symbol_syntax_line_marked(tmp_path):
    """parse_lines 标记语法族，供导出层生成抽样校对报告。"""
    from combo_rules import parse_lines

    keyword = parse_lines("Note: MATH 2421 OR MATH 2431")[0]
    symbol = parse_lines("Core required: EMIA 2020 (3) + EMIA 4110 / MATH 4432 (3)")[0]
    assert keyword["syntax"] == "keyword"
    assert symbol["syntax"] == "symbol"

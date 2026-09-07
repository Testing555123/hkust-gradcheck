"""一次性脚本：解析官方 Common Core 课程清单 PDF → 课程映射 JSON。

产物：frontend/src/data/common-core-course-map.json
  { "meta": {...}, "courses": { "<CODE>": {title, credits, area, group, effectiveFrom, prevCode} } }

用法：.venv/bin/python scripts/gen_common_core_map.py
PDF 路径来自 /Users/dongdong/Documents/GitHub/common core/Active_Course_List_30-credit.pdf
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

PDF_PATH = Path(__file__).resolve().parents[1] / "pipeline/cache/Active_Course_List_30-credit.pdf"
OUT_PATH = Path(__file__).resolve().parents[1] / "frontend/src/data/common-core-course-map.json"

AREA_GROUP = {
    "CTDL": "Foundations",
    "HMW": "Foundations",
    "E-Comm": "Foundations",
    "C-Comm": "Foundations",
    "UxOP": "Experiencing",
    "A": "Broadening",
    "H": "Broadening",
    "S": "Broadening",
    "T": "Broadening",
    "SA": "Broadening",
    "SUS": "Broadening",
    "HAIC": "Broadening",  # 官方清单中 AISC1000 标注（2026-27 cohort 起）
}

# 需要跳过的行：页首过滤器、表头、脚注
SKIP_EXACT = {
    "Fall", "Winter", "Spring", "Summer",
    "Common Core", "Course", "Course Title", "Credit", "Area", "Remarks",
    "Academic Records",
}
SKIP_RE = [
    re.compile(r"^Common Core Course List"),
    re.compile(r"^\(30-credit"),
    re.compile(r"^Common Core Course$"),
    re.compile(r"^with Subject"),
    re.compile(r"^Area Prefix"),
    re.compile(r"^from 20\d{2}-\d{2}\d?$"),  # "from 2023-242"（脚注标记）
    re.compile(r"^Previous Common Core Course Code"),
    re.compile(r'^with "CORE" Prefix'),
    re.compile(r"^(?:Fall|Winter|Spring|Summer)\s+20\d{2}-\d{2}$"),
    re.compile(r"^20\d{2}-\d{2}$"),
    # 文末脚注段（Area 总表与 CORE/双用规则说明）
    re.compile(r"^Common Core Areas\b"),
    re.compile(r"^Notes:"),
    re.compile(r"^Remarks:"),
    re.compile(r"^\([abc]\)\s"),
]
SUBJ_RE = re.compile(r"^(?!SUS$|HAIC$|CTDL$|HMW$)([A-Z]{3,5})$")
SUBJ_NUM_RE = re.compile(r"^([A-Z]{3,5})\s+(\d{4}[A-Z]?)$")
NUM_RE = re.compile(r"^(\d{4}[A-Z]?)$")
CREDIT_RE = re.compile(r"^(\d)$")
CORE_OLD_RE = re.compile(r"^(CORE\s+\d{4}[A-Z]?#?)$")
# Area 单元格与备注粘连的行，如 "SUS From 2025-26 Fall ..." / "A, H C-Comm From 2014-15 ..."
GLUED_AREA_RE = re.compile(
    r"^((?:A|H|S|T|SA|SUS|HAIC|CTDL|HMW|E-Comm|C-Comm|UxOP)"
    r"(?:\s*,\s*(?:A|H|S|T|SA|SUS|HAIC|CTDL|HMW|E-Comm|C-Comm|UxOP))*)\s+(\S.*)$"
)


def is_noise(line: str) -> bool:
    if line in SKIP_EXACT:
        return True
    return any(r.search(line) for r in SKIP_RE)


def split_areas(line: str):
    """把 Area 列解析为多 Area 列表；无法解析返回 None；`--` 返回空表。"""
    if line == "--":
        return []
    # "UxOP – UCOP/UPOP/UROP/UTOP" 等带子类后缀的写法 → 归一为 UxOP
    m = re.match(r"^(UxOP)\s*[–-]", line)
    if m:
        return [m.group(1)]
    parts = [p.strip() for p in line.split(",")]
    if parts and all(p in AREA_GROUP for p in parts):
        return parts
    return None


def parse(lines):
    courses = {}
    warnings = []
    # 状态：subject → num → title... → credit → area(可多行) → remarks
    subj = None
    num = None
    title_lines = []
    credit = None
    area_lines = []
    remarks = []
    prev_code = None
    in_remarks = False  # 课程行解析完成（含 `--` 无 Area），进入备注态

    def flush():
        nonlocal subj, num, title_lines, credit, area_lines, remarks, prev_code, in_remarks
        if not (subj and num and credit and (area_lines or in_remarks)):
            if subj or num or title_lines or credit or area_lines:
                warnings.append(f"未完成记录被丢弃: subj={subj} num={num} credit={credit} area={area_lines}")
            subj, num, title_lines, credit, area_lines, remarks, prev_code, in_remarks = (
                None, None, [], None, [], [], None, False)
            return
        code = f"{subj}{num}"
        areas = [a for a in area_lines if a in AREA_GROUP]
        primary = areas[0] if areas else ""
        courses[code] = {
            "title": " ".join(x.strip() for x in title_lines if x.strip()),
            "credits": int(credit),
            "areas": areas,
            "area": primary,
            "group": AREA_GROUP.get(primary, ""),
            "effectiveFrom": " ".join(remarks).strip(),
            "prevCode": prev_code or "",
        }
        subj, num, title_lines, credit, area_lines, remarks, prev_code, in_remarks = (
            None, None, [], None, [], [], None, False)

    for raw in lines:
        line = raw.strip()
        if not line or is_noise(line):
            continue
        # CORE 旧课号（备注列）
        m = CORE_OLD_RE.match(line)
        if m and (in_remarks or credit is not None):
            if not prev_code:
                prev_code = m.group(1).replace(" ", "").rstrip("#")
            in_remarks = True
            continue

        if in_remarks:
            # 备注/生效日期区：直到下一个科目行
            if line == "--":
                continue
            m1, m3 = SUBJ_RE.match(line), SUBJ_NUM_RE.match(line)
            if m1 or m3:
                flush()
                subj = m3.group(1) if m3 else m1.group(1)
                if m3:
                    num = m3.group(2)
                title_lines, credit, area_lines, remarks, prev_code, in_remarks = (
                    [], None, [], [], None, False)
                continue
            remarks.append(line)
            continue

        if credit is not None:
            # 期待 Area（可多行逗号列表）
            if area_lines and line.endswith(","):
                area_lines.append(line.rstrip(","))
                continue
            areas = split_areas(line)
            if areas is not None:
                area_lines.extend(areas)
                in_remarks = True  # `--`（空列表）也算完成，进入备注态
                continue
            # Area 与备注粘连："SUS From 2025-26 ..." → Area 提取 + 余下进备注
            glued = GLUED_AREA_RE.match(line)
            if glued:
                parsed = split_areas(glued.group(1))
                if parsed is not None:
                    area_lines.extend(parsed)
                    in_remarks = True
                    remarks.append(glued.group(2))
                    continue
            warnings.append(f"学分后出现非 Area 行: {line!r}（课程 {subj}{num}）")
            area_lines.append("__UNKNOWN__")
            in_remarks = True
            remarks.append(line)
            continue

        if subj is not None and num is None:
            m = NUM_RE.match(line)
            if m:
                num = m.group(1)
                continue
            # 学号行不是数字 → 视为课名开始（容错）
            title_lines.append(line)
            continue

        if subj is not None and num is not None:
            # 课名区：直到学分行
            if CREDIT_RE.match(line):
                credit = line
                continue
            title_lines.append(line)
            continue

        # 尚未开始：寻找科目行
        m = SUBJ_NUM_RE.match(line)
        if m:
            subj, num = m.group(1), m.group(2)
            continue
        m = SUBJ_RE.match(line)
        if m:
            subj = m.group(1)
            continue
        # 游离行忽略
    flush()
    return courses, warnings


def main():
    doc = pymupdf.open(PDF_PATH)
    lines = []
    for page in doc:
        lines += [l.strip() for l in page.get_text().splitlines() if l.strip()]
    courses, warnings = parse(lines)

    areas = Counter(c["area"] for c in courses.values())
    payload = {
        "meta": {
            "source": "Active_Course_List_30-credit.pdf (Last update: 16 July 2026)",
            "framework": "30-credit Common Core (admitted 2022-23 onward)",
            "generatedAt": "2026-09-06",
            "courseCount": len(courses),
        },
        "courses": dict(sorted(courses.items())),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"courses: {len(courses)} -> {OUT_PATH}")
    print("area 分布:", dict(areas))
    print(f"warnings: {len(warnings)}")
    for w in warnings[:10]:
        print("  -", w)
    # 抽查样例
    for code in ["HMAW1905", "LANG1402", "CTDL1901", "COMP1001"[:4] + "000"[:0] or "HUMA1000"]:
        if code in courses:
            print("sample:", code, courses[code])


if __name__ == "__main__":
    sys.exit(main())

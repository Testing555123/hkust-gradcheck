"""一次性修复脚本：恢复 common-core-course-map.json 中 Area 丢失（areas: []）的条目。

数据源（均已在 pipeline/cache/ 本地）：
  1. Active_Course_List_30-credit.pdf —— SUS 补充清单（2025-11-19 官方版）。
     表格含每门课「现行 Area + SUS 适用性」的权威配对，命中即最高置信度。
  2. Active_Course_List_full.pdf —— 2023-05-09 完整清单（Spring 2022-23 口径）。
     列：CORE 旧代码 / 标题 / 学分 / Area / Alternate Code（新科目代码）。
     通过 JSON prevCode 或 Alternate Code 匹配，恢复基准 Area（不含 SUS）。

匹配链（逐条尝试）：
  ① SUS 补充清单按课程代码直配（高置信度，含 SUS）
  ② 2023 清单按 prevCode（CORE 代码）或 Alternate Code 匹配（高置信度，无 SUS）
  ③ 标题规范化模糊匹配（低置信度，只进报告不写 JSON）
  ④ 均未命中 → 报告「待人工复核」

用法：
  .venv/Scripts/python.exe scripts/repair_common_core_map.py           # 干跑：只出报告
  .venv/Scripts/python.exe scripts/repair_common_core_map.py --write   # 回写 JSON

输出：
  - pipeline/reports/common_core_area_repair_<日期>.md（人工审阅差异报告）
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "frontend/src/data/common-core-course-map.json"
SUS_PDF = ROOT / "pipeline/cache/Active_Course_List_30-credit.pdf"
FULL_PDF = ROOT / "pipeline/cache/Active_Course_List_full.pdf"
REPORT_DIR = ROOT / "pipeline/reports"

# 与 gen_common_core_map.py 保持一致的 Area → 组归属
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
    "HAIC": "Broadening",
}
VALID_AREAS = set(AREA_GROUP)

# 备注含「… to 20xx-xx」说明该 Area 已停用（历史口径），不写入现行数据
HISTORICAL_RE = re.compile(r"to 20\d{2}-\d{2}")


def norm_code(code: str) -> str:
    """课程代码规范化：去空格、大写（'CHEM 1004' / 'CORE2830' 可比）。"""
    return re.sub(r"\s+", "", code or "").upper()


def norm_title(title: str) -> str:
    """标题规范化：仅保留字母数字，小写，用于模糊比对。"""
    return re.sub(r"[^a-z0-9]", "", (title or "").lower())


def cell(row: list, idx: int) -> str:
    v = row[idx] if idx < len(row) else None
    return (v or "").replace("\n", " ").strip()


def parse_sus_supplement() -> dict[str, dict]:
    """SUS 补充清单：主行（含代码）+ 续行（Area/Remarks），拼出每门课的现行 Area。"""
    out: dict[str, dict] = {}
    with pdfplumber.open(SUS_PDF) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                current: dict | None = None
                for row in table:
                    code_raw = cell(row, 0)
                    area = cell(row, 3)
                    remark = cell(row, 4)
                    if code_raw.startswith(("Common Core", "Courses in")):
                        continue
                    if norm_code(code_raw):
                        code = norm_code(code_raw)
                        current = {
                            "title": cell(row, 1),
                            "areas": [],
                            "remarks": [],
                            "evidence": f"SUS 补充清单（{code_raw}）",
                        }
                        out[code] = current
                    if current is not None and area:
                        # 主行与续行统一处理：现行 Area 采纳，历史口径（… to 20xx）仅记录
                        historical = bool(HISTORICAL_RE.search(remark))
                        areas = [a.strip() for a in area.split(",") if a.strip() in VALID_AREAS]
                        if historical:
                            current["remarks"].append(f"（历史 Area，不采用）{area} {remark}")
                        else:
                            current["areas"].extend(a for a in areas if a not in current["areas"])
                            if remark:
                                current["remarks"].append(remark)
    # 去重保序
    for rec in out.values():
        rec["areas"] = list(dict.fromkeys(rec["areas"]))
    return out


def parse_full_2023() -> dict[str, dict]:
    """2023 完整清单：CORE 旧代码 → {title, areas, alt(新代码), group_hint}。"""
    by_core: dict[str, dict] = {}
    by_alt: dict[str, dict] = {}
    with pdfplumber.open(FULL_PDF) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    code_raw = cell(row, 0)
                    if not code_raw.startswith("CORE"):
                        continue
                    areas = [a.strip() for a in cell(row, 3).split(",") if a.strip() in VALID_AREAS]
                    alt_raw = cell(row, 4)
                    rec = {
                        "core": code_raw,
                        "title": cell(row, 1),
                        "areas": areas,
                        "alt": alt_raw if alt_raw and alt_raw != "--" else "",
                        "evidence": f"2023 完整清单（{code_raw}，Spring 2022-23 口径）",
                    }
                    by_core[norm_code(code_raw)] = rec
                    if rec["alt"]:
                        by_alt[norm_code(rec["alt"])] = rec
    return {"by_core": by_core, "by_alt": by_alt}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="回写 JSON（默认干跑只出报告）")
    args = parser.parse_args()

    payload = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    courses: dict = payload["courses"]
    sus = parse_sus_supplement()
    full = parse_full_2023()
    print(f"源数据：SUS 补充清单 {len(sus)} 门；2023 清单 CORE {len(full['by_core'])} 门 / Alternate {len(full['by_alt'])} 门")

    # 上轮已修复的 11 个条目：除证据冲突需校正者外一律不回退
    PROTECTED = {
        "SUST1030", "CIVL1100", "CIVL1161", "CIVL1210", "FINA1303",
        "MECH1905", "ENVR2020", "ISOM2030", "ISDN2110", "UCOP3200", "CIVL1190",
    }

    broken = {code: rec for code, rec in courses.items() if not rec.get("areas")}
    print(f"JSON 中 areas 为空的条目：{len(broken)} 门")

    applied: list[dict] = []   # 已回写/将回写
    uncertain: list[dict] = [] # 低置信度/未命中，只进报告
    corrections: list[dict] = [] # 对上轮修复的证据校正

    for code, rec in sorted(broken.items()):
        prev_code = norm_code(rec.get("prevCode", ""))
        entry = {
            "code": code, "title": rec.get("title", ""),
            "old_areas": [], "new_areas": None, "source": "", "confidence": "",
        }

        # ① SUS 补充清单直配
        if code in sus and sus[code]["areas"]:
            entry["new_areas"] = sus[code]["areas"]
            entry["source"] = sus[code]["evidence"] + "；" + "；".join(sus[code]["remarks"]) or sus[code]["evidence"]
            entry["confidence"] = "高（官方现行口径，含 SUS）"
            applied.append(entry)
            continue

        # ② 2023 清单：prevCode → Alternate Code
        hit = full["by_core"].get(prev_code) or full["by_alt"].get(code)
        if hit and hit["areas"]:
            entry["new_areas"] = hit["areas"]
            via = f"prevCode={rec.get('prevCode', '')}" if prev_code and full["by_core"].get(prev_code) else f"Alternate Code={hit['alt']}"
            entry["source"] = f"{hit['evidence']}，匹配方式：{via}"
            entry["confidence"] = "高（官方清单，2022-23 口径，无 SUS）"
            applied.append(entry)
            continue

        # ③ 标题模糊匹配（低置信度，不写 JSON）
        nt = norm_title(rec.get("title", ""))
        if nt:
            for pool_name, pool in (("SUS 补充清单", sus), ("2023 清单(Alternate)", full["by_alt"])):
                for cand_code, cand in pool.items():
                    if norm_title(cand.get("title", "")) == nt and cand.get("areas"):
                        entry["source"] = f"标题完全匹配 {pool_name}：{cand_code}「{cand.get('title', '')}」"
                        entry["confidence"] = "低（仅标题匹配，待人工复核，不写 JSON）"
                        entry["new_areas"] = None
                        uncertain.append(entry)
                        break
                if entry in uncertain:
                    break
        if entry in uncertain:
            continue

        entry["source"] = "SUS 补充清单与 2023 清单均未命中"
        entry["confidence"] = "待人工复核"
        uncertain.append(entry)

    # 对上轮已修复条目做证据校正（仅当 SUS 补充清单给出不同现行 Area 时修正）
    for code in sorted(PROTECTED):
        rec = courses.get(code)
        if not rec or code not in sus or not sus[code]["areas"]:
            continue
        official = sus[code]["areas"]
        if rec.get("areas") != official:
            corrections.append({
                "code": code,
                "old_areas": rec.get("areas", []),
                "new_areas": official,
                "source": sus[code]["evidence"] + "；" + "；".join(sus[code]["remarks"]),
            })

    # 回写
    if args.write:
        for entry in applied:
            rec = courses[entry["code"]]
            rec["areas"] = entry["new_areas"]
            rec["area"] = entry["new_areas"][0]
            rec["group"] = AREA_GROUP.get(entry["new_areas"][0], "Broadening")
        for fix in corrections:
            courses[fix["code"]]["areas"] = fix["new_areas"]
            courses[fix["code"]]["area"] = fix["new_areas"][0]
        JSON_PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"已回写 JSON：修复 {len(applied)} 门，校正 {len(corrections)} 门")

    # 生成报告
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = REPORT_DIR / f"common_core_area_repair_{date.today().isoformat()}.md"
    lines = [
        "# Common Core Area 修复报告",
        "",
        f"- 日期：{date.today().isoformat()}",
        f"- 数据源：SUS 补充清单（Active_Course_List_30-credit.pdf，2025-11-19）；2023 完整清单（Active_Course_List_full.pdf，Spring 2022-23 口径）",
        f"- 扫描范围：仅 `areas: []` 的条目（{len(broken)} 门）+ 上轮修复条目的证据校正",
        f"- 结果：修复 {len(applied)} 门，证据校正 {len(corrections)} 门，待人工复核 {len(uncertain)} 门",
        f"- JSON 回写：{'是' if args.write else '否（干跑）'}",
        "",
        "## 一、已修复（Area 恢复）",
        "",
        "| 课程代码 | 标题 | 恢复后 Area | 证据 | 置信度 |",
        "|---|---|---|---|---|",
    ]
    for e in applied:
        lines.append(f"| {e['code']} | {e['title']} | {', '.join(e['new_areas'])} | {e['source']} | {e['confidence']} |")
    lines += ["", "## 二、对上轮修复的证据校正", ""]
    if corrections:
        lines += ["| 课程代码 | 原值 | 校正后（官方口径） | 证据 |", "|---|---|---|---|"]
        for c in corrections:
            lines.append(f"| {c['code']} | {', '.join(c['old_areas']) or '（空）'} | {', '.join(c['new_areas'])} | {c['source']} |")
    else:
        lines.append("无。")
    lines += ["", "## 三、待人工复核（未写 JSON）", ""]
    if uncertain:
        lines += ["| 课程代码 | 标题 | 现有 prevCode | 说明 |", "|---|---|---|---|"]
        for u in uncertain:
            lines.append(f"| {u['code']} | {u['title']} | {u.get('source', '')} | {u['confidence']} |")
    else:
        lines.append("无。")
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"报告已生成：{report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

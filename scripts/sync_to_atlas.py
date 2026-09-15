"""把導出的靜態產物同步到 MongoDB（Atlas 或本機容器）。

設計要點
--------
1. **讀的是導出產物，不是 pipeline/output**：`frontend/public/data/` 才是
   已由 `export_static_data.py` 完成組合規則（combos）、層級池（pool）、
   分支（branch）後處理、且經 CI 一致性斷言的成品。同步層因此完全沒有領域邏輯。
2. **無損搬運**：combos / pool / branch / note / source_ref 原樣寫入，
   不在資料庫端重算 —— 未來任何規則要啟用都不需要重新抽取（抽取要付真實 API 費用）。
3. **冪等**：以 (year, code) / code 為鍵 bulk_write upsert，可安全重跑；
   `--prune` 才刪除已下線的方案與課程（預設關閉）。
4. **不變量即閘門**：寫入前先驗證數量、組數、組合結構；不通過直接退出，
   絕不寫入半份資料。

用法
----
    python scripts/sync_to_atlas.py --dry-run          # 只報告，不連資料庫
    MONGODB_URI=... python scripts/sync_to_atlas.py    # 實際同步
    python scripts/sync_to_atlas.py --prune            # 同步並清除已下線資料
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "frontend" / "public" / "data"
# 跨語言契約（新倉庫 packages/shared/schema）：存在時用 jsonschema 加驗一層；
# 不存在（例如舊倉庫單獨 checkout 的 CI）時自動略過，不視為失敗。
DEFAULT_SCHEMA_DIR = ROOT.parent / "grad-check-web" / "packages" / "shared" / "schema"
DEFAULT_DB = "grad_check"
META_KEY = "current"

PROGRAM_KINDS = ("major", "extm", "minor", "school")
COMBO_KINDS = ("or", "and")

# 允許「範圍課號」（官方課程庫實際存在，如 ENGG2991-2993 / SBMT2100-2110）：
# 取起首課號的學科與級別，尾段範圍不影響篩選歸類。
_CODE_RE = re.compile(r"^([A-Za-z]{2,8})(\d{3,4})[A-Za-z]{0,3}(?:-\d{3,4}[A-Za-z]{0,3})?$")
_CREDIT_RE = re.compile(r"(\d+(?:\.\d+)?)")

PROGRAM_KEY_FIELDS = ("year", "code")
COURSE_KEY_FIELDS = ("code",)


# ── 衍生欄位（與新倉庫 packages/shared 的 kindOf 規則必須一致）──────────────
def kind_of(program_code: str) -> str:
    """方案代碼前綴 → 類別。大小寫敏感：只有完全相符的前綴才判定。"""
    if program_code.startswith("EXTM-"):
        return "extm"
    if program_code.startswith("MINOR-"):
        return "minor"
    if program_code.startswith("SREQ-"):
        return "school"
    return "major"


def derive_subject(code: str) -> str | None:
    """課號前導字母（大寫）；無法判定時 None。"""
    match = _CODE_RE.match(code or "")
    return match.group(1).upper() if match else None


def derive_level(code: str) -> int | None:
    """課號四位數字部分；無法判定時 None。"""
    match = _CODE_RE.match(code or "")
    return int(match.group(2)) if match else None


def parse_credits_value(raw: Any) -> float | None:
    """學分原始字串 → 數值（區間取下限）；無從解析時 None。原字串不做轉換。"""
    if raw is None:
        return None
    match = _CREDIT_RE.search(str(raw))
    return float(match.group(1)) if match else None


def collect_areas(groups: Sequence[dict]) -> list[str]:
    """單一方案內出現過的所有 Area（排序去重）。"""
    areas: set[str] = set()
    for group in groups:
        for course in group.get("courses") or []:
            for area in course.get("areas") or []:
                if area:
                    areas.add(area)
    return sorted(areas)


# ── 文件建構 ────────────────────────────────────────────────────────────────
def build_program_document(entry: dict, program_file: dict, data_version: str) -> dict:
    """index.json 的摘要 + programs/*.json 的要求樹 → MongoDB programs 文件。"""
    program = program_file.get("program") or {}
    groups = list(program_file.get("groups") or [])

    return {
        "year": entry["year"],
        "code": entry["code"],
        "title": entry.get("title") or program.get("title") or "",
        "kind": kind_of(entry["code"]),
        "total_required_credits": float(entry.get("total_required_credits") or 0.0),
        "source_pdf": entry.get("source_pdf"),
        "uncertain": list(program.get("uncertain") or []),
        "group_count": int(entry.get("group_count") or len(groups)),
        "course_count": int(entry.get("course_count") or 0),
        "uncertain_count": int(entry.get("uncertain_count") or 0),
        "has_branches": bool(entry.get("has_branches", False)),
        "branch_count": int(entry.get("branch_count") or 0),
        "data_version": data_version,
        "groups": groups,
    }


def build_course_documents(
    courses: Sequence[dict],
    course_index: dict,
    areas_by_code: dict[str, list[str]],
    data_version: str,
) -> list[dict]:
    """courses.json + course_index.json + 方案內的 Area → MongoDB courses 文件。"""
    documents: list[dict] = []
    for course in courses:
        code = course["code"]
        bucket = course_index.get(code) or {}
        documents.append(
            {
                "code": code,
                "title": course.get("title") or "",
                # 原始欄位一字不改（"3 Credit(s)"），另存數值供篩選
                "credits": course.get("credits"),
                "credits_value": parse_credits_value(course.get("credits")),
                "prerequisites": course.get("prerequisites"),
                "offered_semesters": course.get("offered_semesters"),
                "subject": derive_subject(code),
                "level": derive_level(code),
                "areas": sorted(areas_by_code.get(code) or []),
                "occurrence_count": int(bucket.get("total") or 0),
                "data_version": data_version,
            }
        )
    return documents


def build_meta_document(meta: dict, data_version: str, synced_at: str) -> dict:
    return {
        "key": META_KEY,
        "data_version": data_version,
        "generated_at": str(meta.get("generated_at") or ""),
        "synced_at": synced_at,
        "program_count": int(meta.get("program_count") or 0),
        "course_count": int(meta.get("course_count") or 0),
        "course_index_count": int(meta.get("course_index_count") or 0),
        "years": dict(meta.get("years") or {}),
    }


def compute_data_version(paths: Iterable[Path]) -> str:
    """
    內容哈希聚合：排序後對「檔名 + 檔案內容哈希」逐項餵入 sha256。
    與輸入順序無關，任一檔案內容變動都會改變結果。
    """
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.name):
        digest.update(path.name.encode("utf-8"))
        digest.update(hashlib.sha256(path.read_bytes()).hexdigest().encode("utf-8"))
    return digest.hexdigest()[:16]


# ── 不變量校驗（寫入前的閘門）──────────────────────────────────────────────
def validate_groups(groups: Sequence[dict], label: str) -> list[str]:
    """要求組結構校驗：核心欄位齊全、組合結構合法。"""
    errors: list[str] = []

    for index, group in enumerate(groups):
        where = f"{label} 第 {index + 1} 組"
        if not group.get("name"):
            errors.append(f"{where} 缺少 name")
        if group.get("required_credits") is None:
            errors.append(f"{where} 缺少 required_credits")
        if group.get("order_index") is None:
            errors.append(f"{where} 缺少 order_index")

        for combo_index, combo in enumerate(group.get("combos") or []):
            where_combo = f"{where} 第 {combo_index + 1} 個組合"
            kind = combo.get("kind")
            if kind not in COMBO_KINDS:
                errors.append(f"{where_combo} 的 kind 不合法：{kind!r}")
                continue

            if kind == "or":
                options = combo.get("options") or []
                if len(options) < 2:
                    errors.append(
                        f"{where_combo} 為 OR 但 options 只有 {len(options)} 個（需至少 2 個互斥選項）"
                    )
                for option_index, option in enumerate(options):
                    parts = option.get("parts") or []
                    if not parts:
                        errors.append(f"{where_combo} 第 {option_index + 1} 個選項沒有 parts")
                    for part in parts:
                        if not part.get("courses"):
                            errors.append(f"{where_combo} 有空白的 part（沒有任何課程）")
            else:
                parts = combo.get("parts") or []
                if len(parts) < 2:
                    errors.append(
                        f"{where_combo} 為 AND 但 parts 只有 {len(parts)} 個（需至少 2 個）"
                    )
                for part in parts:
                    if not part.get("courses"):
                        errors.append(f"{where_combo} 有空白的 part（沒有任何課程）")

    return errors


def check_invariants(
    index: Sequence[dict],
    meta: dict,
    program_docs: Sequence[dict],
    course_docs: Sequence[dict],
) -> list[str]:
    """
    與舊倉庫 `export_static_data.py --check` 同一組不變量的「第二道鎖」：
    即使產物被手工改壞，這裡也不會把壞資料寫進資料庫。
    """
    errors: list[str] = []

    if len(index) != len(program_docs):
        errors.append(f"index 筆數 {len(index)} 與方案文件數 {len(program_docs)} 不一致")

    declared_programs = meta.get("program_count")
    if declared_programs != len(index):
        errors.append(
            f"meta.program_count={declared_programs} 與 index 筆數 {len(index)} 不一致"
        )

    declared_courses = meta.get("course_count")
    if declared_courses != len(course_docs):
        errors.append(
            f"meta.course_count={declared_courses} 與課程文件數 {len(course_docs)} 不一致"
        )

    years = meta.get("years") or {}
    if len(years) < 1:
        errors.append("meta.years 為空：至少需涵蓋一個學年")
    elif sum(int(value) for value in years.values()) != declared_programs:
        errors.append(
            f"meta.years 各學年方案數總和 {sum(int(v) for v in years.values())} "
            f"與 program_count={declared_programs} 不一致"
        )

    for document in program_docs:
        label = f"{document.get('year')} {document.get('code')}"
        groups = document.get("groups") or []
        if document.get("group_count") != len(groups):
            errors.append(
                f"{label} 的 group_count={document.get('group_count')} "
                f"與實際組數 {len(groups)} 不一致"
            )
        if not document.get("data_version"):
            errors.append(f"{label} 缺少 data_version")
        errors.extend(validate_groups(groups, label))

    codes = [document["code"] for document in course_docs]
    if len(codes) != len(set(codes)):
        duplicates = sorted({code for code in codes if codes.count(code) > 1})
        errors.append(f"課程文件出現重複課號：{duplicates[:5]}")
    for document in course_docs:
        if not document.get("data_version"):
            errors.append(f"課程 {document.get('code')} 缺少 data_version")

    return errors


def validate_with_schemas(documents: Sequence[dict], schema_path: Path) -> list[str]:
    """若跨語言 JSON Schema 可用，再加驗一層（缺 jsonschema 套件或缺檔案時略過）。"""
    if not schema_path.exists():
        return []
    try:
        import jsonschema  # noqa: PLC0415
    except ImportError:
        return []

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = jsonschema.Draft7Validator(schema)
    errors: list[str] = []
    for document in documents:
        for error in sorted(validator.iter_errors(document), key=lambda e: list(e.path)):
            location = "/".join(str(part) for part in error.path) or "<root>"
            errors.append(f"{schema_path.name} 校驗失敗（{location}）：{error.message}")
            if len(errors) >= 20:
                return errors + ["（其餘省略）"]
    return errors


# ── 產物讀取 ────────────────────────────────────────────────────────────────
def load_artifacts(data_dir: Path) -> dict:
    """讀取導出產物並回傳組裝文件所需的一切。"""
    required = ["index.json", "meta.json", "courses.json", "course_index.json"]
    missing = [name for name in required if not (data_dir / name).exists()]
    programs_dir = data_dir / "programs"
    if not programs_dir.is_dir():
        missing.append("programs/")
    if missing:
        raise FileNotFoundError(
            f"缺少導出產物：{', '.join(missing)}（目錄：{data_dir}）。"
            "請先在舊倉庫運行 python scripts/export_static_data.py。"
        )

    index = json.loads((data_dir / "index.json").read_text(encoding="utf-8"))
    meta = json.loads((data_dir / "meta.json").read_text(encoding="utf-8"))
    courses = json.loads((data_dir / "courses.json").read_text(encoding="utf-8"))
    course_index = json.loads((data_dir / "course_index.json").read_text(encoding="utf-8"))

    program_files: list[tuple[Path, dict]] = []
    for entry in index:
        path = programs_dir / f"{entry['year']}_{entry['code']}.json"
        if not path.exists():
            raise FileNotFoundError(f"index 列出 {entry['year']} {entry['code']}，但找不到 {path.name}")
        program_files.append((path, json.loads(path.read_text(encoding="utf-8"))))

    return {
        "index": index,
        "meta": meta,
        "courses": courses,
        "course_index": course_index,
        "program_files": program_files,
    }


def build_all(artifacts: dict, data_version: str, synced_at: str) -> dict:
    """產物 → 三組待寫入文件。純函式，可由測試直接呼叫。"""
    # 課程 → Area 聯集：Area 只存在於方案的要求組內，課程庫本身沒有這個欄位
    areas_by_code: dict[str, list[str]] = {}
    collected: dict[str, set[str]] = {}
    for _, program_file in artifacts["program_files"]:
        for group in program_file.get("groups") or []:
            for course in group.get("courses") or []:
                bucket = collected.setdefault(course["code"], set())
                for area in course.get("areas") or []:
                    if area:
                        bucket.add(area)
    for code, areas in collected.items():
        areas_by_code[code] = sorted(areas)

    program_docs = [
        build_program_document(entry, program_file, data_version)
        for entry, (_, program_file) in zip(artifacts["index"], artifacts["program_files"])
    ]
    course_docs = build_course_documents(
        artifacts["courses"], artifacts["course_index"], areas_by_code, data_version
    )
    meta_doc = build_meta_document(artifacts["meta"], data_version, synced_at)

    return {"programs": program_docs, "courses": course_docs, "meta": meta_doc}


# ── 同步 ────────────────────────────────────────────────────────────────────
def sync_to_mongo(uri: str, db_name: str, payload: dict, prune: bool) -> dict:
    """冪等 upsert；回傳統計供日誌與 CI 摘要使用。"""
    from pymongo import MongoClient, UpdateOne  # noqa: PLC0415

    client = MongoClient(uri, serverSelectionTimeoutMS=15_000, appname="grad-check-sync")
    try:
        database = client[db_name]
        programs = database["programs"]
        courses = database["courses"]
        meta = database["meta"]

        program_ops = [
            UpdateOne({field: doc[field] for field in PROGRAM_KEY_FIELDS}, {"$set": doc}, upsert=True)
            for doc in payload["programs"]
        ]
        course_ops = [
            UpdateOne({field: doc[field] for field in COURSE_KEY_FIELDS}, {"$set": doc}, upsert=True)
            for doc in payload["courses"]
        ]

        program_result = programs.bulk_write(program_ops, ordered=False)
        course_result = courses.bulk_write(course_ops, ordered=False)

        meta.update_one({"key": payload["meta"]["key"]}, {"$set": payload["meta"]}, upsert=True)

        removed = {"programs": 0, "courses": 0}
        if prune:
            keep_programs = [
                {"year": doc["year"], "code": doc["code"]} for doc in payload["programs"]
            ]
            keep_courses = [doc["code"] for doc in payload["courses"]]
            removed["programs"] = programs.delete_many({"$nor": keep_programs}).deleted_count
            removed["courses"] = courses.delete_many({"code": {"$nin": keep_courses}}).deleted_count

        # 索引交由 API 端（Mongoose autoIndex）建立；此處不重複宣告，避免兩處定義漂移
        return {
            "programs_upgraded": program_result.upserted_count,
            "programs_modified": program_result.modified_count,
            "courses_upgraded": course_result.upserted_count,
            "courses_modified": course_result.modified_count,
            "meta": payload["meta"],
            "removed": removed,
        }
    finally:
        client.close()


# ── CLI ─────────────────────────────────────────────────────────────────────
def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="把導出產物同步到 MongoDB")
    parser.add_argument("--uri", default=os.environ.get("MONGODB_URI"), help="MongoDB 連線字串")
    parser.add_argument("--db", default=os.environ.get("MONGODB_DB", DEFAULT_DB), help="資料庫名")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="導出產物目錄")
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR), help="共用 JSON Schema 目錄")
    parser.add_argument("--dry-run", action="store_true", help="只建構並校驗，不連資料庫")
    parser.add_argument("--prune", action="store_true", help="刪除已下線的方案與課程")
    parser.add_argument("--skip-schema", action="store_true", help="略過 JSON Schema 校驗")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    data_dir = Path(args.data_dir).resolve()

    print(f"[info] 讀取產物：{data_dir}")
    artifacts = load_artifacts(data_dir)

    data_version = compute_data_version(
        [data_dir / name for name in ("index.json", "meta.json", "courses.json", "course_index.json")]
        + [path for path, _ in artifacts["program_files"]]
    )
    synced_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    payload = build_all(artifacts, data_version, synced_at)

    print(
        f"[ok] 建構完成：方案 {len(payload['programs'])} 份、課程 {len(payload['courses'])} 門、"
        f"資料版本 {data_version}"
    )

    errors = check_invariants(
        artifacts["index"], artifacts["meta"], payload["programs"], payload["courses"]
    )
    errors.extend(
        validate_with_schemas(payload["programs"], Path(args.schema_dir) / "program.schema.json")
    )
    errors.extend(
        validate_with_schemas(payload["courses"], Path(args.schema_dir) / "course.schema.json")
    )
    errors.extend(
        validate_with_schemas([payload["meta"]], Path(args.schema_dir) / "meta.schema.json")
    )

    if errors:
        print(f"[error] 不變量校驗失敗（{len(errors)} 項），未寫入任何資料：", file=sys.stderr)
        for message in errors:
            print(f"  - {message}", file=sys.stderr)
        return 1
    print("[ok] 不變量與 schema 校驗通過")

    if args.dry_run:
        print("[info] dry-run：跳過資料庫寫入。")
        return 0

    if not args.uri:
        # 明確的「略過」而非失敗：Atlas 叢集尚未建立時，CI 不應因此變紅
        print(
            "::notice::未設定 MONGODB_URI，已跳過同步。"
            "建立 Atlas 叢集後將連線字串設為 repository secret（MONGODB_URI）即可啟用。"
        )
        return 0

    print(f"[info] 同步至資料庫 {args.db}（prune={args.prune}）")
    stats = sync_to_mongo(args.uri, args.db, payload, args.prune)
    print(
        "[ok] 寫入完成："
        f"方案 新增 {stats['programs_upgraded']} / 更新 {stats['programs_modified']}，"
        f"課程 新增 {stats['courses_upgraded']} / 更新 {stats['courses_modified']}"
    )
    if args.prune:
        print(
            f"[ok] 清除已下線資料：方案 {stats['removed']['programs']} 份、"
            f"課程 {stats['removed']['courses']} 門"
        )
    print(f"::notice::同步完成，資料版本 {data_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

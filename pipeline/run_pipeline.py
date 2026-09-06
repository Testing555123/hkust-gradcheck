"""管线编排 CLI。

示例：
    # 单专业样本验证（pymupdf 快速解析 + LLM 抽取）
    py -m run_pipeline --year 2026-27 --code COMP

    # 批量（MinerU 在线 API 默认），断点续跑
    py -m run_pipeline --all

    # 只重跑 crosscheck
    py -m run_pipeline --crosscheck-only

环境变量：MINERU_API_TOKEN / GRAD_LLM_API_KEY / GRAD_LLM_BASE_URL / GRAD_LLM_MODEL
"""

import argparse
import json
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent
sys.path.insert(0, str(PIPELINE_DIR))

from crosscheck import crosscheck, write_report  # noqa: E402
from llm_extract import extract_requirements  # noqa: E402
from parsers import parse_with_cache  # noqa: E402

PDF_ROOT = PROJECT_ROOT / "unpress_pdf" / "major"
INDEX_JSON = PDF_ROOT / "index.json"
CACHE_DIR = PIPELINE_DIR / "cache"
OUTPUT_DIR = PIPELINE_DIR / "output"
REPORTS_DIR = PIPELINE_DIR / "reports"
SOURCE_DB = PROJECT_ROOT / "courses.db"


def load_index() -> list[dict]:
    data = json.loads(INDEX_JSON.read_text(encoding="utf-8"))
    return [d for d in data if d.get("status") == "downloaded"]


def select_targets(args) -> list[dict]:
    targets = load_index()
    if args.all:
        return targets
    picked = [
        t
        for t in targets
        if (args.year is None or t["year"] == args.year)
        and (args.code is None or t["code"].upper() == args.code.upper())
    ]
    if not picked:
        raise SystemExit(f"index 中未匹配到 year={args.year} code={args.code} 的已下载 PDF")
    return picked


def run_one(target: dict, parser_name: str, force: bool, skip_llm: bool) -> Path | None:
    year, code = target["year"], target["code"]
    pdf_path = PDF_ROOT / year / target["filename"]
    if not pdf_path.exists():
        print(f"[skip] PDF 不存在: {pdf_path}")
        return None

    out_file = OUTPUT_DIR / f"requirements_{year}_{code}.json"
    if out_file.exists() and not force:
        print(f"[skip] 产物已存在（断点续跑）: {out_file.name}，--force 可覆盖")
        return out_file

    print(f"== {year} {code}: {target['title']}")
    doc = parse_with_cache(str(pdf_path), parser_name, CACHE_DIR)
    print(f"   parsed by {doc.parser_name}: {doc.page_count} pages")

    result_json: dict
    if skip_llm:
        result_json = {
            "year": year,
            "code": code,
            "title": target["title"],
            "parser": doc.parser_name,
            "text_with_pages": doc.text_with_page_markers(),
            "_skipped_llm": True,
        }
    else:
        result = extract_requirements(doc, year, code)
        result_json = result.model_dump()
        result_json["parser"] = doc.parser_name
        result_json["source_pdf"] = str(pdf_path)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(result_json, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"   -> {out_file.relative_to(PROJECT_ROOT)}")
    return out_file


def run_crosscheck_all() -> None:
    from schemas import ExtractionResult

    files = sorted(OUTPUT_DIR.glob("requirements_*.json"))
    if not files:
        print("output/ 下没有 requirements_*.json，先运行抽取。")
        return
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        if data.get("_skipped_llm"):
            continue
        result = ExtractionResult.model_validate(data)
        report = crosscheck(result, SOURCE_DB)
        _, md_path = write_report(report, REPORTS_DIR)
        print(
            f"[crosscheck] {report['year']} {report['code']}: "
            f"{report['checked_courses']} 课 / {report['issue_count']} 差异 -> {md_path.name}"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="毕业要求离线数据管线")
    ap.add_argument("--parser", default="mineru_api", choices=["mineru_api", "mineru_local", "pymupdf"])
    ap.add_argument("--year", default=None, help="如 2026-27")
    ap.add_argument("--code", default=None, help="专业代码，如 COMP")
    ap.add_argument("--all", action="store_true", help="批量处理 index 中全部已下载 PDF")
    ap.add_argument("--force", action="store_true", help="覆盖已存在产物（断点续跑默认跳过）")
    ap.add_argument("--skip-llm", action="store_true", help="只解析不调 LLM（快速验证 parser）")
    ap.add_argument("--crosscheck-only", action="store_true", help="只对现有产物重跑学分核对")
    args = ap.parse_args()

    if args.crosscheck_only:
        run_crosscheck_all()
        return

    targets = select_targets(args)
    print(f"targets: {len(targets)}（parser={args.parser}）")
    for t in targets:
        try:
            run_one(t, args.parser, args.force, args.skip_llm)
        except Exception as exc:  # noqa: BLE001 — 单份失败不中断批量
            print(f"[error] {t['year']} {t['code']}: {exc}")

    if not args.skip_llm:
        run_crosscheck_all()


if __name__ == "__main__":
    main()

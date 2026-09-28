"""双 pass 核对编排 CLI（worker 通过 spawn 调用它）。

    py -m agents.run_agents --year 2026-27 --code COMP --pdf unpress_pdf/major/2026-27/COMP_....pdf
    py -m agents.run_agents --year 2026-27 --code COMP --pdf ... --no-pass-b   # 只跑 Pass A + 确定性校验

产物（三份，全部落在 output/agent/<year>/<code>/，**不覆盖** run_pipeline 的 255 份存量产物）：
- requirements.json  最终抽取结果（已应用仲裁补丁）
- chunks.json        切片层（原文 + 页码 + chunk_id，供人工复核对照）
- review.json        核对报告（findings / 仲裁 / 确定性校验 / degraded）

退出码：0 成功；1 失败（worker 据此重试）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from agents.arbiter import arbitrate, make_llm_judge  # noqa: E402
from agents.deterministic import run_all  # noqa: E402
from agents.diff import diff_results  # noqa: E402
from agents.schemas import DiffReport  # noqa: E402
from agents.patch import apply_patch  # noqa: E402
from agents.schemas import PassBResult  # noqa: E402
from extract_b import run_pass_b  # noqa: E402
from grounding import build_chunks  # noqa: E402
from llm_extract import extract_requirements  # noqa: E402
from parsers import parse_with_cache  # noqa: E402
from run_pipeline import classify_type  # noqa: E402
from schemas import ExtractionResult  # noqa: E402

CACHE_DIR = PIPELINE_DIR / "cache"
OUTPUT_DIR = PIPELINE_DIR / "output"
DEFAULT_OUT_DIR = OUTPUT_DIR / "agent"


def load_existing_result(
    output_root: Path, year: str, code: str
) -> ExtractionResult | None:
    """读取既有抽取产物（pipeline/output/<类别>/<code>/requirements_<year>_<code>.json）。

    用途：没有 LLM key 时把它当 Pass A。这 255 份是人工校对过的，
    用它做基线比重新抽一遍更稳，而且零成本。
    """
    path = output_root / classify_type(code) / code / f"requirements_{year}_{code}.json"
    if not path.exists():
        return None
    return ExtractionResult.model_validate(json.loads(path.read_text(encoding="utf-8")))


def resolve_pass_a_source(requested: str) -> str:
    """auto = 有 key 走 LLM，没 key 退回既有产物。

    这样「没有 key」不再是一条死路，而是自动降到「只用存量 + 确定性校验」的档位。
    """
    if requested not in {"auto", "llm", "existing"}:
        raise ValueError(f"未知的 --pass-a 取值：{requested}（可用：auto / llm / existing）")
    if requested != "auto":
        return requested
    return "llm" if os.environ.get("GRAD_LLM_API_KEY", "").strip() else "existing"


def _relative_source_pdf(pdf_path: Path) -> str:
    """转成相对 PROJECT_ROOT 的路径：gates.ts 拒绝绝对路径入库。"""
    try:
        return str(pdf_path.resolve().relative_to(PROJECT_ROOT))
    except ValueError:
        return pdf_path.name


def run(
    year: str,
    code: str,
    pdf_path: Path,
    parser_name: str = "pymupdf",
    with_pass_b: bool = True,
    out_dir: Path = DEFAULT_OUT_DIR,
    pdf_hash: str = "",
    pass_a_source: str = "auto",
) -> int:
    program_key = f"{year}/{code}"
    target_dir = out_dir / year / code
    target_dir.mkdir(parents=True, exist_ok=True)

    doc = parse_with_cache(str(pdf_path), parser_name, CACHE_DIR)
    print(f"[{program_key}] parsed by {doc.parser_name}: {doc.page_count} pages")

    # ---- Pass A ----
    resolved_source = resolve_pass_a_source(pass_a_source)
    if resolved_source == "existing":
        result_a = load_existing_result(OUTPUT_DIR, year, code)
        if result_a is None:
            raise SystemExit(
                f"[{program_key}] 没有既有产物可用："
                f"{OUTPUT_DIR / classify_type(code) / code}\n"
                "配好 GRAD_LLM_API_KEY 后重跑，或用 --pass-a llm 显式走 LLM 抽取。"
            )
        print(f"[{program_key}] pass A: 复用既有产物，{len(result_a.groups)} groups")
    else:
        result_a = extract_requirements(doc, year, code)
        print(f"[{program_key}] pass A: {len(result_a.groups)} groups")

    # ---- Pass B：langextract 第二意见；失败则退化为「仅确定性校验」 ----
    pass_b: PassBResult | None = None
    degraded_reason: str | None = None
    if with_pass_b:
        try:
            pass_b = run_pass_b(doc, year, code, program_key)
            print(
                f"[{program_key}] pass B: {len(pass_b.result.groups)} groups, "
                f"degraded={pass_b.degraded}"
            )
        except Exception as exc:  # noqa: BLE001 — 第二意见不可用不应砸掉主流程
            degraded_reason = f"第二 pass 不可用，已退化为仅确定性校验：{exc}"
            print(f"[{program_key}] {degraded_reason}")

    if pass_b is None:
        # 没有第二意见就不做比对：否则 Pass A 的每个条目都会被报成 missing，
        # 那是纯噪音，而且会把「待人工复核」列表灌满假条目。
        report = DiffReport(year=year, code=code, findings=[])
        print(f"[{program_key}] diff: 跳过（无第二 pass）")
    else:
        report = diff_results(result_a, pass_b.result, pass_b.evidence)
        print(
            f"[{program_key}] diff: agree={len(report.agreed)} "
            f"conflict={len(report.conflicts)} missing={len(report.missing)}"
        )

    source_pdf = _relative_source_pdf(pdf_path)
    issues = run_all(result_a, source_pdf=source_pdf)
    if issues:
        print(f"[{program_key}] deterministic: {len(issues)} 条问题")

    judge = make_llm_judge(doc.text_with_page_markers()) if with_pass_b else None
    arbitration = arbitrate(report, deterministic_issues=issues, judge_fn=judge)
    print(
        f"[{program_key}] arbitration: accepted={len(arbitration.accepted)} "
        f"rejected={len(arbitration.rejected)} unresolved={len(arbitration.unresolved)}"
    )

    final, applied, skipped = apply_patch(result_a, arbitration.final_patch)

    # ---- 落盘 ----
    requirements = final.model_dump()
    requirements["parser"] = doc.parser_name
    requirements["source_pdf"] = source_pdf
    requirements["provenance"] = {
        "pass_a": "llm_extract",
        "pass_b": "langextract" if pass_b else None,
        "applied_patch": applied,
        "skipped_patch": skipped,
        "pdf_hash": pdf_hash or None,
    }
    (target_dir / "requirements.json").write_text(
        json.dumps(requirements, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    chunks = [
        {
            "chunk_id": c.chunk_id,
            "page": c.page,
            "ordinal": c.ordinal,
            "char_start": c.char_start,
            "char_end": c.char_end,
            "text": c.text,
        }
        for c in build_chunks(doc, program_key)
    ]
    (target_dir / "chunks.json").write_text(
        json.dumps(
            {"program_key": program_key, "source_pdf": source_pdf, "chunks": chunks},
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    review = {
        "year": year,
        "code": code,
        "program_key": program_key,
        "source_pdf": source_pdf,
        "pdf_hash": pdf_hash or None,
        "degraded_reason": degraded_reason,
        "pass_b_degraded": pass_b.degraded if pass_b else None,
        "diff": [f.model_dump(mode="json") for f in report.findings],
        "deterministic": [i.model_dump() for i in issues],
        "arbitration": arbitration.model_dump(),
        "needs_human_review": arbitration.needs_human_review,
    }
    (target_dir / "review.json").write_text(
        json.dumps(review, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    # out_dir 可能在 PROJECT_ROOT 之外（单测用 tmp_path），relative_to 会抛 ValueError
    try:
        shown: Path | str = target_dir.relative_to(PROJECT_ROOT)
    except ValueError:
        shown = target_dir
    print(f"[{program_key}] -> {shown}")
    return 0


def main() -> None:
    # Windows 控制台默认 cp950/GBK，print 中文会直接崩（实测踩坑）。
    # 在入口处把标准流切到 UTF-8，比依赖调用方设置环境变量更可靠。
    for stream in (sys.stdout, sys.stderr):
        encoding = getattr(stream, "encoding", "") or ""
        if encoding.lower() not in ("utf-8", "utf8"):
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    ap = argparse.ArgumentParser(description="双 pass 交叉核对编排")
    ap.add_argument("--year", required=True, help="如 2026-27")
    ap.add_argument("--code", required=True, help="专业代码，如 COMP")
    ap.add_argument("--pdf", required=True, help="PDF 路径（相对 PROJECT_ROOT 或绝对）")
    ap.add_argument("--parser", default="pymupdf", choices=["mineru_api", "mineru_local", "pymupdf"])
    ap.add_argument("--no-pass-b", action="store_true", help="跳过第二 pass")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    ap.add_argument("--pdf-hash", default="", help="PDF 内容哈希，用于写库幂等与 lastPipelineHash")
    ap.add_argument(
        "--pass-a",
        default="auto",
        choices=["auto", "llm", "existing"],
        help="Pass A 来源：auto=有 key 走 LLM、没 key 复用既有产物；existing=强制复用；llm=强制抽取",
    )
    args = ap.parse_args()

    pdf = Path(args.pdf)
    if not pdf.is_absolute():
        pdf = PROJECT_ROOT / pdf
    if not pdf.exists():
        raise SystemExit(f"PDF 不存在: {pdf}")

    sys.exit(
        run(
            year=args.year,
            code=args.code,
            pdf_path=pdf,
            parser_name=args.parser,
            with_pass_b=not args.no_pass_b,
            out_dir=Path(args.out_dir),
            pdf_hash=args.pdf_hash,
            pass_a_source=args.pass_a,
        )
    )


if __name__ == "__main__":
    main()

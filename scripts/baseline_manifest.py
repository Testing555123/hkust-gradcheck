#!/usr/bin/env python3
"""T1 黄金基准：把权威数据钉死在一个 commit 上（blob SHA 取自 git，与工作树无关）。

  gen   —— 生成 baseline/manifest.json（不含时间戳，跑两次字节一致）
  check —— 用 HEAD 重算并与已提交清单比对，被改过就非 0 退出并点名
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SCOPE = ("pipeline/output", "frontend/public/data", "courses.db")
# meta.json 带生成时间戳，本就该每次烘焙都变，且 CI 的 diff 门也刻意排除了它
EXCLUDE = "frontend/public/data/meta.json"


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True,
                          capture_output=True, text=True).stdout


# 两个语义必须分开，不能共用一个字段（实测踩过：数据基线因 ADR-12 规范化而前移，
# 结果把"平移忠诚度"的比对基准也一起推到了移动之后的提交，闸门当场失效）。
#   baseline_commit      —— 数据 blob 的基准，可随数据提交有意重钉
#   port_baseline_commit —— 领域层平移的比对基准，钉死在"移动之前"的那个提交，不随 gen 移动
PORT_BASELINE = "67effce"


def build():
    files = {}
    for line in git("ls-tree", "-r", "--format=%(path)\t%(objectname)", "HEAD").splitlines():
        path, _, sha = line.partition("\t")
        if (path.startswith(SCOPE) or path == "courses.db") and path != EXCLUDE:
            files[path] = sha
    head = git("rev-parse", "HEAD").strip()
    doc = {"schema_version": 2, "baseline_commit": head, "port_baseline_commit": PORT_BASELINE,
           "file_count": len(files),
           "note": "blob SHA 取自 git HEAD；刻意不含时间戳以保证可复现", "files": files}
    return head, files, json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("gen", "check"))
    ap.add_argument("--manifest", type=Path, default=ROOT / "baseline" / "manifest.json")
    ap.add_argument("--allow-dirty", action="store_true",
                    help="gen 时允许工作树存在未提交的权威数据改动（默认拒绝）")
    args = ap.parse_args()
    head, files, payload = build()
    built = json.loads(payload)
    dirty = {ln[3:].strip() for ln in git("status", "--porcelain", "--", *SCOPE).splitlines()}
    drift = sorted(p for p in dirty if p in files)

    if args.mode == "gen":
        # 关键防线：gen 会重钉 baseline_commit。若权威数据此刻是脏的，一次 gen
        # 就会把坏数据悄悄升格成新基线（本仓库当前就有 58 个未提交数据改动，真风险）。
        if drift and not args.allow_dirty:
            print(f"[FAIL] 工作树有 {len(drift)} 个权威数据文件未提交，拒绝把脏状态钉成新基线。"
                  f"\n  先提交或还原它们；确有必要则加 --allow-dirty", file=sys.stderr)
            for p in drift[:5]:
                print(f"    {p}", file=sys.stderr)
            return 1
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(payload, encoding="utf-8")
        print(f"[gen] {head[:7]} · 钉死 {len(files)} 个权威数据文件；"
              f"工作树另有 {len(drift)} 个未提交改动不在基准内")
        return 0

    if not args.manifest.exists():
        print("[FAIL] 基准清单不存在", file=sys.stderr)
        return 1
    committed = json.loads(args.manifest.read_text(encoding="utf-8"))

    # 空转防线：比对集合本身不能为空/骤减，否则「0 个文件逐 blob 一致」也是绿 —— 假绿。
    reasons: list[str] = []
    expected = committed.get("file_count")
    if not files:
        reasons.append("当前 HEAD 下受保护文件为 0 —— SCOPE 失效，闸门无意义")
    elif isinstance(expected, int) and len(files) < expected:
        reasons.append(f"受保护文件数 {len(files)} < 基线记录 {expected} —— 有文件从基准中消失")
    if committed.get("schema_version") != built.get("schema_version"):
        reasons.append(f"schema_version 变了：{committed.get('schema_version')} -> {built.get('schema_version')}")
    old = committed.get("files", {})
    for p in sorted(set(old) ^ set(files)):
        reasons.append(f"基准外的文件出现/消失：{p}")
    for p in sorted(set(old) & set(files)):
        if old[p] != files[p]:
            reasons.append(f"内容已变：{p}  {old[p][:8]} -> {files[p][:8]}")
    if committed.get("baseline_commit") != head:
        print(f"[info] 基线钉在 {committed.get('baseline_commit','?')[:7]}，当前 HEAD 是 {head[:7]}"
              "（正常：基线不随代码提交移动）")
    if reasons:
        for r in reasons[:40]:
            print(f"[FAIL] {r}", file=sys.stderr)
        if len(reasons) > 40:
            print(f"[FAIL] …另有 {len(reasons) - 40} 条", file=sys.stderr)
        print(f"[FAIL] 基准校验未通过，共 {len(reasons)} 条 —— 需重新 gen 才算有意推进基线", file=sys.stderr)
        return 1
    print(f"[ok] 基准校验通过：{committed.get('baseline_commit','?')[:7]} · {len(files)} 个文件逐 blob 一致")
    if drift:
        print(f"[warn] 工作树有 {len(drift)} 个未提交改动尚未进基准，例：{drift[:3]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

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


def build():
    files = {}
    for line in git("ls-tree", "-r", "--format=%(path)\t%(objectname)", "HEAD").splitlines():
        path, _, sha = line.partition("\t")
        if (path.startswith(SCOPE) or path == "courses.db") and path != EXCLUDE:
            files[path] = sha
    head = git("rev-parse", "HEAD").strip()
    doc = {"schema_version": 1, "baseline_commit": head, "file_count": len(files),
           "note": "blob SHA 取自 git HEAD；刻意不含时间戳以保证可复现", "files": files}
    return head, files, json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("gen", "check"))
    ap.add_argument("--manifest", type=Path, default=ROOT / "baseline" / "manifest.json")
    args = ap.parse_args()
    head, files, payload = build()
    dirty = {ln[3:].strip() for ln in git("status", "--porcelain", "--", *SCOPE).splitlines()}
    drift = sorted(p for p in dirty if p in files)

    if args.mode == "gen":
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(payload, encoding="utf-8")
        print(f"[gen] {head[:7]} · 钉死 {len(files)} 个权威数据文件；"
              f"工作树另有 {len(drift)} 个未提交改动不在基准内")
        return 0

    if not args.manifest.exists():
        print("[FAIL] 基准清单不存在", file=sys.stderr)
        return 1
    if args.manifest.read_text(encoding="utf-8") != payload:
        old = json.loads(args.manifest.read_text(encoding="utf-8")).get("files", {})
        for p in sorted(set(old) ^ set(files)):
            print(f"[FAIL] 基准外的文件出现/消失：{p}", file=sys.stderr)
        for p in sorted(set(old) & set(files)):
            if old[p] != files[p]:
                print(f"[FAIL] 内容已变：{p}  {old[p][:8]} -> {files[p][:8]}", file=sys.stderr)
        return 1
    print(f"[ok] 基准校验通过：{head[:7]} · {len(files)} 个文件逐 blob 一致")
    if drift:
        print(f"[warn] 工作树有 {len(drift)} 个未提交改动尚未进基准，例：{drift[:3]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

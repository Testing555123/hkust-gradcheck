#!/usr/bin/env python3
"""ADR-12 落地：把 pipeline/output/** 的源文件重写成规范形式（谁是格式权威的答案）。

规范形式 = json.dumps(obj, indent=2, ensure_ascii=False) + 尾换行，且整数值不写成 22.0。
实测该形式对 255/255 份是不动点（读→写→读→写 字节不变），所以本脚本可反复跑，
也让「后台改 → 写回源 → 重烘焙」的回环不会自造 diff。

刻意不动的：键顺序（dict 保序）、source_pdf 的绝对路径（那是 ADR-10 的另一件事）。

  --check  只报告有多少份偏离规范形式（非 0 退出），供 CI 防漂移
  --apply  重写
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
SRC = ROOT / "pipeline" / "output"


def integralize(o):
    if isinstance(o, dict):
        return {k: integralize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [integralize(v) for v in o]
    if isinstance(o, float) and o == int(o):
        return int(o)
    return o


def canonical(text: str) -> str:
    return json.dumps(integralize(json.loads(text)), indent=2, ensure_ascii=False) + "\n"


def files():
    # 实际布局：pipeline/output/<类别>/<CODE>/requirements_<year>_<code>.json
    return sorted(SRC.glob("*/*/requirements_*.json"))


def main() -> int:
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="只报告，不写盘（默认）")
    mode.add_argument("--apply", action="store_true", help="重写为规范形式")
    args = ap.parse_args()

    all_files = files()
    deviated, changed_numbers = [], 0
    for f in all_files:
        raw = f.read_text(encoding="utf-8")
        canon = canonical(raw)
        if raw == canon:
            continue
        deviated.append(f)
        if raw.count(".0") > canon.count(".0"):
            changed_numbers += 1

    if not args.apply:
        print(f"[check] 偏离规范形式: {len(deviated)}/{len(all_files)} 份（未写盘）")
        if deviated:
            for f in deviated[:5]:
                print(f"    {f.relative_to(ROOT).as_posix()}")
            print(f"[FAIL] {len(deviated)} 份源不是规范形式 —— 双写回环会自造 diff（ADR-12）", file=sys.stderr)
            return 1
        print("[ok] 全部源文件均为规范形式")
        return 0

    for f in deviated:
        text = f.read_text(encoding="utf-8")
        tmp = f.with_suffix(".json.tmp")
        tmp.write_text(canonical(text), encoding="utf-8")
        tmp.replace(f)  # 原子写：不留半截文件（§8.2 缺陷之一）
    print(f"[apply] 已改写 {len(deviated)} 份，其中 {changed_numbers} 份含 22.0→22 类数字归一")
    out = subprocess.run(["git", "diff", "--stat", "--", "pipeline/output"],
                         cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()
    if out:
        print("  " + out[-1])
    return 0


if __name__ == "__main__":
    sys.exit(main())

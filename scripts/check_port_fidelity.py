#!/usr/bin/env python3
"""T3 平移忠诚度校验：证明「换栈没换口径」在领域层这一侧是可证伪的。

做法：把 packages/domain 里每个被移动的文件取回 HEAD 版本，逐字比对「非 import 行」。
逻辑行必须一字不差；只有 import 语句允许变（目录结构变了，不改不行）。
  python scripts/check_port_fidelity.py            # 校验
  python scripts/check_port_fidelity.py --list     # 只看对照表
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
MODULES = ["attached", "audit", "branch", "combos", "common-core", "course-filter",
           "group-filter", "pools", "profile", "program-groups", "transcript"]
OLD_PREFIX = "frontend/src/"
NEW_PREFIX = "packages/domain/src/"


def git_show(rev_path: str) -> str | None:
    r = subprocess.run(["git", "show", rev_path], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8")
    return r.stdout if r.returncode == 0 else None


def logic_lines(src: str) -> list[str]:
    """丢掉 import 语句的边界行，留下全部逻辑与类型名。"""
    keep = []
    for ln in src.splitlines():
        s = ln.strip()
        if not s or s.startswith("import ") or s.startswith("from \"") or s == ");":
            continue
        if s.startswith("} from") or s.startswith("export * from"):
            continue
        keep.append(s)
    return keep


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    pairs = []
    for stem in MODULES + ["types"]:
        sub = "lib/" if stem != "types" else ""
        for suffix in ("", ".test"):
            rel = f"{sub}{stem}{suffix}.ts"
            if (ROOT / NEW_PREFIX / rel).exists():
                pairs.append((f"{stem}{suffix}", NEW_PREFIX + rel, OLD_PREFIX + rel))
    if args.list:
        for name, new, old in pairs:
            print(f"{name:26} {old}  ->  {new}")
        return 0

    checked, bad, missing = 0, [], []
    for name, new, old in pairs:
        path = ROOT / new
        if not path.exists():
            missing.append(name)
            continue
        before = git_show(f"HEAD:{old}")
        if before is None:
            missing.append(f"{name}(HEAD 无 {old})")
            continue
        checked += 1
        a, b = logic_lines(before), logic_lines(path.read_text(encoding="utf-8"))
        if a != b:
            i = next((k for k, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            bad.append((name, len(a), len(b), a[i:i + 1], b[i:i + 1]))

    for name, la, lb, x, y in bad:
        print(f"[FAIL] {name}: 逻辑行 {la}->{lb} 首个差异 @\n  HEAD: {x}\n  现在: {y}", file=sys.stderr)
    if missing:
        print(f"[warn] 未参与比对：{missing}", file=sys.stderr)
    if bad:
        return 1
    print(f"[ok] {checked} 个文件的非 import 逻辑行与 HEAD 逐字一致 —— 领域层口径未被平移改动")
    return 0


if __name__ == "__main__":
    sys.exit(main())

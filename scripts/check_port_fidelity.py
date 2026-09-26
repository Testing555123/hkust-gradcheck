#!/usr/bin/env python3
"""T3 平移忠诚度校验：证明「换栈没换口径」在领域层这一侧是可证伪的。

做法：把 packages/domain 里每个被移动的文件取回 HEAD 版本，逐字比对「非 import 行」。
逻辑行必须一字不差；只有 import 语句允许变（目录结构变了，不改不行）。
  python scripts/check_port_fidelity.py            # 校验
  python scripts/check_port_fidelity.py --list     # 只看对照表
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
MODULES = ["attached", "audit", "branch", "combos", "common-core", "course-filter",
           "group-filter", "pools", "profile", "program-groups", "transcript"]
OLD_PREFIX = "frontend/src/"
NEW_PREFIX = "packages/domain/src/"


def git_show(rev_path: str) -> str | None:
    r = subprocess.run(["git", "show", rev_path], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8")
    return r.stdout if r.returncode == 0 else None


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8")
    return r.stdout if r.returncode == 0 else ""


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


def baseline_ref() -> str:
    """比对基准 = 黄金基线清单里钉死的 commit，不是 HEAD。

    用 HEAD 是 v1 的缺陷：平移一旦提交，HEAD 里已无 frontend/src/lib/*，
    于是 git show 全部失败、比对 0 个文件却报 [ok] —— 空转的闸门比没有闸门更坏。
    """
    manifest = ROOT / "baseline" / "manifest.json"
    if not manifest.exists():
        print(f"[warn] 基线清单不存在（{manifest}），退回 HEAD 比对 —— "
              "平移一旦提交，HEAD 里已无 frontend/src/lib/*，本闸门会因比对数不足而失败", file=sys.stderr)
        return git("rev-parse", "HEAD").strip()
    try:
        return str(json.loads(manifest.read_text(encoding="utf-8"))["baseline_commit"])
    except Exception as err:  # noqa: BLE001
        # 绝不静默降级：上一版这里用 bare except 吞掉了 NameError，
        # 结果比对基准悄悄变成 HEAD，闸门假绿了一整轮。
        print(f"[FAIL] 基线清单不可读（{err.__class__.__name__}: {err}）—— 拒绝退回 HEAD", file=sys.stderr)
        raise SystemExit(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--baseline", default=None, help="比对基准 commit，默认取 baseline/manifest.json")
    args = ap.parse_args()
    ref = args.baseline or baseline_ref()

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
        before = git_show(f"{ref}:{old}")
        if before is None:
            missing.append(f"{name}({ref[:7]} 无 {old})")
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
    # 空转防线：一个都没比到就是闸门失效，不是通过。
    if checked < len(pairs):
        print(f"[FAIL] 应比对 {len(pairs)} 个文件，实际只比到 {checked} 个 —— 基准 ref 或路径已失效", file=sys.stderr)
        return 1
    if bad:
        return 1
    print(f"[ok] {checked} 个文件的非 import 逻辑行与基准 {ref[:7]} 逐字一致 —— 领域层口径未被平移改动")
    return 0


if __name__ == "__main__":
    sys.exit(main())

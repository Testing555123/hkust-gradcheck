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
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
MODULES = ["attached", "audit", "branch", "combos", "common-core", "course-filter",
           "group-filter", "pools", "profile", "program-groups", "transcript"]
OLD_PREFIX = "frontend/src/"
NEW_PREFIX = "packages/domain/src/"
# 被拆分的文件：一个旧文件 = 若干新文件之和。transcript 的浏览器 IO 段（File API +
# Vite 专有 ?url）移到 frontend/src/lib/pdf-text.ts —— 留在领域层，后端一 import 就炸。
SPLITS: dict[str, list[str]] = {
    "transcript": ["packages/domain/src/lib/transcript.ts", "frontend/src/lib/pdf-text.ts"],
}


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
        # 注释不是口径：闸门主张的是「逻辑行未变」，说明性注释允许增删。
        # 被注释掉的代码仍会被抓到 —— 那属于代码行变化。
        if s.startswith(("//", "/*", "*/", "*")):
            continue
        # 剥掉可见性关键字：T2b 为跨包复用把 MIN_TEXT_LENGTH 改成导出，
        # 可见性变化不是口径变化。
        if s.startswith("export ") and not s.startswith("export default"):
            s = s[len("export "):]
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
            news = SPLITS.get(f"{stem}{suffix}", [NEW_PREFIX + rel])
            if all((ROOT / n).exists() for n in news):
                pairs.append((f"{stem}{suffix}", news, OLD_PREFIX + rel))
    if args.list:
        for name, news, old in pairs:
            print(f"{name:26} {old}  ->  {' + '.join(news)}")
        return 0

    checked, bad, missing = 0, [], []
    for name, news, old in pairs:
        before = git_show(f"{ref}:{old}")
        if before is None:
            missing.append(f"{name}({ref[:7]} 无 {old})")
            continue
        checked += 1
        a = logic_lines(before)
        parts = [logic_lines((ROOT / n).read_text(encoding="utf-8")) for n in news]
        if len(parts) == 1:
            b = parts[0]
            same = a == b
            i = next((k for k, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            xa, xb = a[i:i + 1], b[i:i + 1]
        else:
            # 拆分文件：整块搬移后顺序会变，故比**多重集**（少一行或多一行都会红）
            ca, cb = Counter(a), Counter(sum(parts, []))
            same = ca == cb
            only_a = list((ca - cb).elements())[:2]
            only_b = list((cb - ca).elements())[:2]
            xa, xb = only_a or ["(无缺失)"], only_b or ["(无多余)"]
        if not same:
            bad.append((name, len(a), sum(len(p) for p in parts), xa, xb))

    for name, la, lb, x, y in bad:
        print(f"[FAIL] {name}: 逻辑行 {la}->{lb}\n  基准里有、现在没有: {x}\n  现在有、基准里没有: {y}",
              file=sys.stderr)
    if missing:
        print(f"[warn] 未参与比对：{missing}", file=sys.stderr)
    # 空转防线：期望数必须来自**基准树**，不能来自"当前存在哪些文件"的自指计数
    # （否则藏起一个文件，期望与实到一起变小，闸门照样绿 —— 上一版就是这样）。
    # 期望数来自「基准树里这些模块确实存在」逐一探测：
    # 不能扫目录 —— frontend/src/lib 下还有 utils.ts / static-data.ts 两个本就不该移动的文件，
    # 把它们算进期望会造成假失败（实测踩过）。也不能用当前目录的自指计数（会随藏文件一起变小）。
    expected = 0
    for stem in MODULES + ["types"]:
        sub = "lib/" if stem != "types" else ""
        for suffix in ("", ".test"):
            if git_show(f"{ref}:{OLD_PREFIX}{sub}{stem}{suffix}.ts") is not None:
                expected += 1
    if not expected:
        print(f"[FAIL] 基准 {ref[:7]} 下找不到任何待比对文件 —— 基准或路径已失效", file=sys.stderr)
        return 1
    if checked < expected:
        print(f"[FAIL] 基准有 {expected} 个待比对文件，实际只比到 {checked} 个 —— "
              "有文件被藏起/改名/丢失，闸门不得判绿", file=sys.stderr)
        return 1
    if bad:
        return 1
    print(f"[ok] {checked}/{expected} 个文件的非 import 逻辑行与基准 {ref[:7]} 逐字一致"
          " —— 领域层口径未被平移改动")
    return 0


if __name__ == "__main__":
    sys.exit(main())

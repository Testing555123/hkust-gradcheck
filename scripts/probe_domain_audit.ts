/**
 * 检视工具：在 Node 里直接跑「平移后的领域引擎」。
 *
 * 存在的意义是证明一件事：改之前这件事做不到 ——
 *   extractTranscriptText() 里用了 Vite 专有后缀 `?url`，
 *   后端/脚本一 import 领域层就炸（T2b 之前）。
 * 现在同一个包能被 tsx 直接加载并算出结果。
 *
 * 跑法：npm run probe:audit
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { computeProgramAudit } from "../packages/domain/src/lib/audit"
import { effectiveCourseCount } from "../packages/domain/src/lib/combos"
import type { CourseStatus, RequirementGroup } from "../packages/domain/src/types"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const YEAR = process.env.PROBE_YEAR ?? "2024-25"
const CODE = process.env.PROBE_CODE ?? "MATH"

const doc = JSON.parse(
  readFileSync(path.join(ROOT, "frontend/public/data/programs", `${YEAR}_${CODE}.json`), "utf8"),
) as { program: Record<string, unknown>; groups: RequirementGroup[] }

const line = (s = "") => console.log(s)
line(`\n=== ${CODE} ${YEAR} —— 由 Node 直接加载 packages/domain 算出 ===`)
line(`源文件出处: ${String(doc.program.source_pdf ?? "")}`)
line(`要求组 ${doc.groups.length} 个；含互斥分支的组 ${
  doc.groups.filter((g) => (g as { branch_kind?: string }).branch_kind).length
} 个`)

// ---------- 1. §4.2 互斥分支：分母随「选没选方向」而变 ----------
const empty: Record<string, CourseStatus> = {}
const branchGroups = doc.groups.filter((g) => (g as { branch_kind?: string }).branch_kind).length

line(`\n[1] 互斥分支（§4.2）`)
if (branchGroups) {
  const branchName = (doc.groups.find((g) => (g as { branch_kind?: string }).branch_kind) as {
    branch?: string
  }).branch as string
  // 注意：不传 opts 走的是「历史一致」全组并列口径，不是「未选方向」。
  const noBranch = computeProgramAudit(doc.groups, empty, { selectedBranch: null })
  const flatWrong = computeProgramAudit(doc.groups, empty).totalRequired
  const withBranch = computeProgramAudit(doc.groups, empty, { selectedBranch: branchName })
  line(`    未选方向（opts 传 null）→ 总要求 ${noBranch.totalRequired} 学分（只剩公共核心）`)
  line(`    选「${branchName}」      → 总要求 ${withBranch.totalRequired} 学分`)
  line(`    全组并列累加（错误口径）  → ${flatWrong} 学分，分母被放大 ${(flatWrong / withBranch.totalRequired).toFixed(1)} 倍`)
} else {
  line(`    本方案无互斥分支，总要求 ${computeProgramAudit(doc.groups, empty).totalRequired} 学分`)
}

// ---------- 2. §4.1 组合折叠：分两种结构分别验，别拿嵌套当单选 ----------
const pureOr = doc.groups
  .flatMap((g) => (g.combos ?? []).map((c) => [g, c] as const))
  .find(([, c]) => (c.options ?? []).length >= 2 && (c.options ?? []).every((o) => (o.parts ?? []).length === 1))
const nested = doc.groups
  .flatMap((g) => (g.combos ?? []).map((c) => [g, c] as const))
  .find(([, c]) => (c.options ?? []).some((o) => (o.parts ?? []).length >= 2))

if (pureOr) {
  const [g, combo] = pureOr
  const opts = (combo.options ?? []).map((o) => o.parts![0].courses[0].code)
  line(`\n[2a] 纯「N 选一」组合（§4.1 规则 1/3）—— ${g.name}: ${opts.join(" OR ")}`)
  const one = computeProgramAudit([g], { [opts[0]]: "taken" }).groups[0]
  const all = computeProgramAudit([g], Object.fromEntries(opts.map((c) => [c, "taken" as CourseStatus]))).groups[0]
  line(`     只勾 1 门 → takenCredits ${one.takenCredits}；把 ${opts.length} 个备选全勾 → takenCredits ${all.takenCredits}`)
  line(`     ${one.takenCredits === all.takenCredits
    ? "✅ 备选项没有被重复累加（这就是「把备选项重复计入」那类误判被挡住的地方）"
    : "❌ 折叠失效：备选项被重复累加了"}`)
}
if (nested) {
  const [g, combo] = nested
  const opt0 = combo.options![0]
  const allCodes = opt0.parts!.flatMap((p) => p.courses.map((c) => c.code))
  const half = computeProgramAudit([g], { [allCodes[0]]: "taken" }).groups[0]
  const whole = computeProgramAudit([g], Object.fromEntries(
    opt0.parts!.map((p) => [p.courses[0].code, "taken" as CourseStatus])),
  ).groups[0]
  line(`\n[2b] 嵌套 AND-in-OR（§4.1 规则 2「部分完成计 0」）—— ${g.name}`)
  line(`     只勾该选项的第 1 个 part → takenCredits ${half.takenCredits}`)
  line(`     把该选项所有 part 勾齐   → takenCredits ${whole.takenCredits}`)
  line(`     ${half.takenCredits === 0 && whole.takenCredits > 0
    ? "✅ 捆绑只完成一半时不计分，勾齐才计分 —— 误判成「已得学分」会直接算错还差几学分"
    : "❌ 部分完成口径不符"}`)
  line(`     有效门数：本组平铺 ${g.courses?.length ?? 0} 门 → 折算 ${effectiveCourseCount(g)} 门`)
}

// ---------- 3. §4.4 逐组封顶：A 组超修不抵 B 组缺口 ----------
const over = computeProgramAudit(doc.groups, Object.fromEntries(
  (doc.groups[0].courses ?? []).map((c) => [c.code, "taken" as CourseStatus]),
))
line(`\n[3] 逐组封顶（§4.4）`)
line(`    把第 1 组「${doc.groups[0].name}」全部标记已修：`)
line(`    totalTaken ${over.totalTaken} / totalRequired ${over.totalRequired} → ${over.percentTaken.toFixed(1)}%`)
line(`    该组自身 takenCredits ${over.groups[0].takenCredits}，要求 ${over.groups[0].requiredCredits}` +
  ` → 计入方案级时被封顶为 ${Math.min(over.groups[0].takenCredits, over.groups[0].requiredCredits)}`)
line(`    ${over.groups[0].takenCredits > over.groups[0].requiredCredits
    ? "✅ 超修部分没有拿去抵其他组的缺口"
    : "（该组未超修，换个组看）"}`)

line(`\n换别的方案：PROBE_YEAR=2026-27 PROBE_CODE=ELEC npm run probe:audit`)

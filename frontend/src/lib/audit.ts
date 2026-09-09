import type {
  CourseRef,
  CourseStatus,
  GroupAudit,
  ProgramAudit,
  RequirementGroup,
} from "@/types";
import { filterGroupsByBranch } from "@/lib/branch";

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

function sumCredits(courses: CourseRef[], predicate: (c: CourseRef) => boolean): number {
  return courses.reduce((acc, c) => (predicate(c) ? acc + c.credits : acc), 0);
}

/**
 * 学分进度核算纯函数：O(n) 单次遍历，无副作用。
 * - taken：已修课程学分和
 * - planned：已修 + 计划学分和（计划建立在已修之上）
 * - 缺口：计划后仍未覆盖的课程（按组内顺序保留）
 */
export function computeGroupAudit(
  group: RequirementGroup,
  status: Record<string, CourseStatus>
): GroupAudit {
  const required = group.required_credits;

  const takenCredits = sumCredits(group.courses, (c) => status[c.code] === "taken");
  const plannedCredits = sumCredits(
    group.courses,
    (c) => status[c.code] === "taken" || status[c.code] === "planned"
  );

  const cappedTaken = Math.min(takenCredits, required);
  const cappedPlanned = Math.min(plannedCredits, required);

  // 缺口课程：未被已修或计划覆盖的课程，按学分从大到小排（优先补大课）
  const missingCourses = group.courses
    .filter((c) => status[c.code] === undefined)
    .sort((a, b) => b.credits - a.credits);

  return {
    group,
    requiredCredits: required,
    takenCredits,
    plannedCredits,
    percentTaken: required > 0 ? clampPct((cappedTaken / required) * 100) : takenCredits > 0 ? 100 : 0,
    percentPlanned: required > 0 ? clampPct((cappedPlanned / required) * 100) : 100,
    remaining: Math.max(0, required - plannedCredits),
    // 开放式层级池组不渲染逐課缺口（避免「还需 N 百门」噪声），仅显示进度摘要
    missingCourses: group.pool ? [] : missingCourses,
    isDone: required > 0 && takenCredits >= required,
  };
}

/** 分支口径：不传则保持「全部组累加」的旧行为 */
export interface ProgramAuditOptions {
  /** 已选一级分支名（如 "Applied Mathematics Track"） */
  selectedBranch?: string | null;
  /** 已选二级分支名（如 CHEM Core Chemistry Track 下的 "Materials Chemistry Option"） */
  selectedSubBranch?: string | null;
}

/**
 * 方案级核算。传入 opts 时先把组收窄到「公共核心 + 已选分支」再求和——
 * 互斥分支（Track / Option）若全部并列累加，分母会被放大到真实值的数倍。
 * 不传 opts 时行为与历史一致（供附加要求等无分支口径复用）。
 */
export function computeProgramAudit(
  groups: RequirementGroup[],
  status: Record<string, CourseStatus>,
  opts?: ProgramAuditOptions
): ProgramAudit {
  const scoped = opts
    ? filterGroupsByBranch(groups, opts.selectedBranch ?? null, opts.selectedSubBranch ?? null)
    : groups;
  const groupAudits = scoped.map((g) => computeGroupAudit(g, status));

  const totalRequired = groupAudits.reduce((a, g) => a + g.requiredCredits, 0);
  const totalTaken = groupAudits.reduce((a, g) => a + Math.min(g.takenCredits, g.requiredCredits), 0);
  const totalPlanned = groupAudits.reduce((a, g) => a + Math.min(g.plannedCredits, g.requiredCredits), 0);
  const missingCount = groupAudits.reduce((a, g) => a + g.missingCourses.length, 0);

  return {
    groups: groupAudits,
    totalRequired,
    totalTaken,
    totalPlanned,
    percentTaken: totalRequired > 0 ? clampPct((totalTaken / totalRequired) * 100) : 0,
    percentPlanned: totalRequired > 0 ? clampPct((totalPlanned / totalRequired) * 100) : 0,
    remaining: Math.max(0, totalRequired - totalPlanned),
    missingCount,
  };
}

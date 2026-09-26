import type { BranchOption, RequirementGroup } from "../types";

/**
 * 互斥分支（Track / Option）聚合与过滤：纯函数，O(n) 单次遍历，无副作用。
 *
 * 背景：同一主修内部常有若干互斥分支，学生只能择一修读，且各分支学分下限不同
 * （如 2025-26 MATH 的 8 个 Track 附加学分从 +24 到 +43 不等）。
 * 因此进度分母必须是「公共核心 + 已选分支」，把所有分支并列累加会把分母放大数倍。
 */

export interface BranchSummary {
  /** 一级分支（parent 为 null 或父分支缺失者），按首次出现顺序 */
  branches: BranchOption[];
  /** 全部分支（含二级），按首次出现顺序 */
  all: BranchOption[];
  /** 按分支名索引，便于 O(1) 取用 */
  byName: Record<string, BranchOption>;
  /** 公共核心学分：所有非分支组 required_credits 之和 */
  coreCredits: number;
  hasBranches: boolean;
}

/** 从要求组聚合出分支清单；无分支组时返回空清单与全部组学分。 */
export function collectBranches(groups: RequirementGroup[]): BranchSummary {
  const order: string[] = [];
  const byName: Record<string, BranchOption> = {};
  let coreCredits = 0;

  for (const g of groups) {
    const name = g.branch;
    if (!name) {
      coreCredits += g.required_credits;
      continue;
    }
    let b = byName[name];
    if (!b) {
      b = {
        name,
        kind: g.branch_kind === "option" ? "option" : "track",
        optional: g.branch_optional ?? true,
        parent: g.parent_branch ?? null,
        credits: 0,
        groupIds: [],
        children: [],
      };
      byName[name] = b;
      order.push(name);
    }
    b.credits += g.required_credits;
    b.groupIds.push(g.id);
  }

  const all = order.map((n) => byName[n]);
  // 二级分支挂到父分支下；父分支缺失时降级为一级，避免层级丢失
  const branches: BranchOption[] = [];
  for (const b of all) {
    const parent = b.parent ? byName[b.parent] : undefined;
    if (parent && parent !== b) {
      parent.children.push(b);
    } else {
      b.parent = null;
      branches.push(b);
    }
  }

  return { branches, all, byName, coreCredits, hasBranches: all.length > 0 };
}

/**
 * 该组是否计入当前学分口径。
 *
 * - 非分支组：恒计入（公共核心）
 * - 一级分支组：仅当它是已选分支时计入
 * - 二级分支组：仅当父分支已选 **且** 它自己是已选子分支时计入
 */
export function isGroupActive(
  group: RequirementGroup,
  selectedBranch: string | null,
  selectedSubBranch: string | null
): boolean {
  if (!group.branch) return true;
  if (!selectedBranch) return false;
  if (group.branch === selectedBranch) return true;
  if (group.parent_branch && group.parent_branch === selectedBranch) {
    return group.branch === selectedSubBranch;
  }
  return false;
}

/** 按已选分支过滤出参与进度计算的组；无分支的方案原样返回。 */
export function filterGroupsByBranch(
  groups: RequirementGroup[],
  selectedBranch: string | null,
  selectedSubBranch: string | null
): RequirementGroup[] {
  return groups.filter((g) => isGroupActive(g, selectedBranch, selectedSubBranch));
}

/** 选中某分支后的总学分下限 = 公共核心 + 该分支（+ 已选二级分支）。 */
export function totalCreditsWithBranch(
  summary: BranchSummary,
  selectedBranch: string | null,
  selectedSubBranch: string | null
): number {
  if (!selectedBranch) return summary.coreCredits;
  const branch = summary.byName[selectedBranch];
  const sub = selectedSubBranch ? summary.byName[selectedSubBranch] : undefined;
  return summary.coreCredits + (branch?.credits ?? 0) + (sub?.credits ?? 0);
}

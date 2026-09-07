/**
 * 要求组级状态派生（纯函数，不依赖 React，便于单测）。
 *
 * 与课程态筛选（lib/course-filter）并列，但维度不同：这里是「一个毕业要求组」
 * 的达标情况，供「要求明细」页的状态筛选 chips 与分区计数使用。
 *
 * 状态口径：
 * - done（已达标）：已修学分已覆盖要求（主修）或各桶已满足（通识）
 * - pending（未达标）：已开始修读但未完成
 * - untouched（未开始）：尚未修读任何学分
 */
import type { CourseStatus, RequirementGroup } from "@/types";
import type { CommonCoreGroup } from "@/lib/common-core";
import { computeGroupAudit } from "@/lib/audit";

export type GroupFilterState = "all" | "done" | "pending" | "untouched";

/** 主修 / 附加要求组状态：基于 computeGroupAudit 的 takenCredits 与 isDone */
export function computeGroupFilterState(
  group: RequirementGroup,
  status: Record<string, CourseStatus>
): GroupFilterState {
  const audit = computeGroupAudit(group, status);
  if (audit.takenCredits === 0) return "untouched";
  if (audit.isDone) return "done";
  return "pending";
}

/** 通识核心组状态：基于各桶 completedCredits（已修 + 计划）与 allMet，与区块「已完成」徽标口径一致 */
export function computeCcGroupFilterState(g: CommonCoreGroup): GroupFilterState {
  const allMet = g.buckets.every((b) => b.completedCredits >= b.required);
  if (allMet && g.buckets.some((b) => b.required > 0)) return "done";
  const started = g.buckets.some((b) => b.completedCredits > 0);
  return started ? "pending" : "untouched";
}

/** 单个组状态是否匹配当前筛选 */
export function matchesGroupFilter(state: GroupFilterState, filter: GroupFilterState): boolean {
  return filter === "all" || filter === state;
}

export function countByGroupStatus(states: GroupFilterState[]): Record<GroupFilterState, number> {
  const counts: Record<GroupFilterState, number> = {
    all: states.length,
    done: 0,
    pending: 0,
    untouched: 0,
  };
  for (const s of states) counts[s] += 1;
  return counts;
}

export const GROUP_FILTER_OPTIONS: { value: GroupFilterState; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "done", label: "已达标" },
  { value: "pending", label: "未达标" },
  { value: "untouched", label: "未开始" },
];

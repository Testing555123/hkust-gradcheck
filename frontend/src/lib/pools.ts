import type {
  CourseDetail,
  CourseRef,
  CourseStatus,
  ProgramTreeData,
  RequirementGroup,
} from "@/types";

/** 从课程码抽取层级（4 位数字）：MATH2010 → 2010；无数字返回 0 */
export function courseLevel(code: string): number {
  const m = code.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 解析开放式层级池组的真实课程：code 以 subject 开头且层级 ≥ minLevel。
 * 非池组原样返回 g.courses（保持导出时的固定清单与顺序）。
 */
export function resolveGroupCourses(
  group: RequirementGroup,
  courses: CourseDetail[]
): CourseRef[] {
  if (!group.pool) return group.courses;
  const { subject, minLevel } = group.pool;
  const prefix = subject.toUpperCase();
  return courses
    .filter(
      (c) => c.code.toUpperCase().startsWith(prefix) && courseLevel(c.code) >= minLevel
    )
    .map((c) => ({
      code: c.code,
      name: c.title,
      credits: parseFloat(c.credits ?? "") || 0,
    }));
}

/**
 * 已讀優先排序：已修 → 计划 → 其余；同档内按课程码升序。
 * 仅用于池组的「頭10個」展示，不改变学分核算（核算用全量课程）。
 */
export function sortTakenFirst(
  courses: CourseRef[],
  status: Record<string, CourseStatus>
): CourseRef[] {
  const rank = (c: CourseRef) => {
    const s = status[c.code];
    if (s === "taken") return 0;
    if (s === "planned") return 1;
    return 2;
  };
  return [...courses].sort((a, b) => {
    const r = rank(a) - rank(b);
    return r !== 0 ? r : a.code.localeCompare(b.code);
  });
}

/** 将池组的课程解析为真实课程清单（courses 未加载时原样返回，池组暂为空） */
export function resolveTree(
  tree: ProgramTreeData,
  courses: CourseDetail[] | undefined
): ProgramTreeData {
  if (!courses || !tree.groups.some((g) => g.pool)) return tree;
  return {
    ...tree,
    groups: tree.groups.map((g) =>
      g.pool ? { ...g, courses: resolveGroupCourses(g, courses) } : g
    ),
  };
}

/** 课程状态筛选纯逻辑：不依赖 React，便于单测。 */

/** 单个学科前缀：大写课号前导字母（如 "COMP"）+ 全量课程中该前缀的数量 */
export interface SubjectPrefix {
  code: string;
  count: number;
}

/**
 * 从课程列表提取学科前缀（课号前导字母，大写）并计数，按字母序返回。
 * 用于「课程选择」页的学科代码网格（全校所有现有科目）。
 */
export function extractSubjectPrefixes(
  courses: { code: string }[]
): SubjectPrefix[] {
  const counts = new Map<string, number>();
  for (const c of courses) {
    const m = c.code.match(/^[A-Za-z]+/);
    if (!m) continue;
    const prefix = m[0].toUpperCase();
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type CourseStatus = "taken" | "planned";
export type CourseFilterState = "all" | "taken" | "planned" | "none";

export interface FlatCourseWithStatus {
  code: string;
  name: string;
  credits: number;
  groupNames: string[];
  /** 当前勾选状态；未勾选为 undefined */
  status?: CourseStatus;
}

/** 把全局勾选状态附加到扁平课程列表上（不修改入参） */
export function attachStatus(
  courses: FlatCourseWithStatus[],
  status: Record<string, CourseStatus>
): FlatCourseWithStatus[] {
  return courses.map((c) => (status[c.code] ? { ...c, status: status[c.code] } : { ...c }));
}

/** 按筛选态过滤：none = 未勾选（既非已修也非计划） */
export function applyFilter(
  courses: FlatCourseWithStatus[],
  filter: CourseFilterState
): FlatCourseWithStatus[] {
  if (filter === "all") return courses;
  if (filter === "none") return courses.filter((c) => !c.status);
  return courses.filter((c) => c.status === filter);
}

/** 各筛选态计数（供 chips 徽标显示） */
export function countByStatus(
  courses: FlatCourseWithStatus[]
): Record<CourseFilterState, number> {
  const counts: Record<CourseFilterState, number> = {
    all: courses.length,
    taken: 0,
    planned: 0,
    none: 0,
  };
  for (const c of courses) {
    if (!c.status) counts.none += 1;
    else counts[c.status] += 1;
  }
  return counts;
}

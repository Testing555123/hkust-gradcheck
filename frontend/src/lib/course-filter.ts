/** 课程状态筛选纯逻辑：不依赖 React，便于单测。 */

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

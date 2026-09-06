/** 前端业务类型（与后端 API 契约对齐） */

export interface ProgramInfo {
  year: string;
  code: string;
  title: string;
  total_required_credits: number;
  source_pdf?: string | null;
}

export interface CourseRef {
  code: string;
  name: string;
  credits: number;
  /** 选修课所属 Area（可多个，同课可属多 Area）；非选修为空 */
  areas?: string[];
}

export interface RequirementGroup {
  id: number;
  name: string;
  required_credits: number;
  min_courses?: number | null;
  source_ref?: string | null;
  /** 官方 Note 说明原文（来自 PDF） */
  note?: string | null;
  order_index: number;
  courses: CourseRef[];
}

export interface ProgramTreeData {
  program: ProgramInfo;
  groups: RequirementGroup[];
}

export type CourseStatus = "taken" | "planned";

/** 单个要求组的学分核算结果 */
export interface GroupAudit {
  group: RequirementGroup;
  requiredCredits: number;
  takenCredits: number;
  plannedCredits: number;
  /** 已修完成度百分比（0-100，上限 100） */
  percentTaken: number;
  /** 计划后预计完成度百分比 */
  percentPlanned: number;
  /** 计划后仍缺学分 */
  remaining: number;
  /** 计划后仍未覆盖的课程（缺口清单） */
  missingCourses: CourseRef[];
  isDone: boolean;
}

export interface ProgramAudit {
  groups: GroupAudit[];
  totalRequired: number;
  totalTaken: number;
  totalPlanned: number;
  percentTaken: number;
  percentPlanned: number;
  remaining: number;
  /** 缺口课程总数（跨组去重前） */
  missingCount: number;
}

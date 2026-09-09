/**
 * 前端业务类型（唯一契约源）。
 *
 * 数据由 scripts/export_static_data.py 从 pipeline/output/ + courses.db 预生成，
 * 见 lib/static-data.ts。站点无后端，运行时只读这些静态 JSON。
 */

export interface ProgramInfo {
  year: string;
  code: string;
  title: string;
  total_required_credits: number;
  /** 官方 PDF 出处（仓库相对路径，如 unpress_pdf/major/2026-27/COMP_xxx.pdf） */
  source_pdf?: string | null;
  /** LLM 抽取时的存疑说明：仅完整方案中携带（index 列表不含全文） */
  uncertain?: string[];
  /** 以下三项只出现在 index.json 的列表项里，供选择器展示规模 */
  group_count?: number;
  course_count?: number;
  uncertain_count?: number;
  /** 该方案是否含互斥分支（Track / Option）：含分支时须先选方向，学分口径才准确 */
  has_branches?: boolean;
  /** 一级分支数量 */
  branch_count?: number;
}

/** courses.json 单条：官方课程库详情 */
export interface CourseDetail {
  code: string;
  title: string;
  credits?: string | null;
  prerequisites?: string | null;
  offered_semesters?: string | null;
}

/** course_index.json 单条：某门课被哪个方案的哪个要求组引用 */
export interface CourseIndexEntry {
  year: string;
  code: string;
  group: string;
  credits: number;
}

/** 反向索引按课程码分组；items 最多 50 条，total 为真实引用总数 */
export interface CourseIndexBucket {
  total: number;
  items: CourseIndexEntry[];
}

export type CourseIndex = Record<string, CourseIndexBucket>;

export interface CourseRef {
  code: string;
  name: string;
  credits: number;
  /** 选修课所属 Area（可多个，同课可属多 Area）；非选修为空 */
  areas?: string[];
}

export interface RequirementGroup {
  /** 组内序号（导出脚本生成，等于 order_index），仅用于 React key */
  id: number;
  name: string;
  required_credits: number;
  min_courses?: number | null;
  source_ref?: string | null;
  /** 官方 Note 说明原文（来自 PDF） */
  note?: string | null;
  order_index: number;
  courses: CourseRef[];
  /**
   * 开放式层级池标记（单学科 "N000-level or above" 组由导出脚本写入）。
   * subject = 4 字母学科前缀（如 MATH），minLevel = 最低层级（2000/3000/4000/5000）。
   * 前端据此从 courses.json 过滤出真实可选课程；院/校级池（SB&M、SENG、SSCI 等）为 null。
   */
  pool?: { subject: string; minLevel: number } | null;
  /**
   * 所属互斥分支名（如 "Applied Mathematics Track"）。
   * 同一主修内学生只能择一分支修读，各分支学分下限不同；
   * 非分支组不带这四个字段（导出脚本只在识别出分支时写入，见 pipeline/apply_branches.py）。
   */
  branch?: string | null;
  /** 分支官方叫法 */
  branch_kind?: "track" | "option" | null;
  /** true = 可不选（不选则不计入进度分母） */
  branch_optional?: boolean;
  /** 二级分支的父分支名（如 CHEM Core Chemistry Track 下的 Option） */
  parent_branch?: string | null;
}

/** 从 groups 聚合出的分支选项，供选择器与分组渲染使用 */
export interface BranchOption {
  name: string;
  kind: "track" | "option";
  /** true = 可不选（不选则不计入分母） */
  optional: boolean;
  /** 二级分支的父分支名；一级分支为 null */
  parent: string | null;
  /** 该分支各组 required_credits 之和 */
  credits: number;
  groupIds: number[];
  /** 二级子分支（如 CHEM Core Chemistry Track 下的三个 Option） */
  children: BranchOption[];
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

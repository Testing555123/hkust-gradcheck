/**
 * HKUST Common Core（30 学分通识核心）审核引擎。
 *
 * 移植自用户既有 Python 项目 `common core`（checker/requirements），并按
 * Stellic / DegreeWorks 的 unused-credits 概念修复 ANY 槽重复计数、
 * 实现 CTDL/UxOP 选修替代规则；规则表数据驱动（json-rules-engine 范式）。
 *
 * 规则出处：官方 Active Course List（30-credit，2022-23 起）+ 原 Python 项目。
 * 已知待校准：2025-26+ 新增 SUS 后总分为各桶之和（33），与官方「30 学分」表述
 * 的对齐方式以 AR 官网为准（UI 已注明）。
 */

import courseMapJson from "../data/common-core-course-map.json";
import type { CourseStatus } from "../types";

/* ---------- 规则表 ---------- */

export const CC_AREA_NAMES: Record<string, string> = {
  CTDL: "Critical Thinking & Data Literacy",
  HMW: "Habits, Mindsets, and Wellness",
  "E-Comm": "English Communication",
  "C-Comm": "Chinese Communication",
  A: "Arts",
  H: "Humanities",
  S: "Science",
  T: "Technology",
  SA: "Social Analysis",
  SUS: "Sustainability",
  UxOP: "Undergraduate Experiential Opportunities Programs",
  HAIC: "Human-AI Co-Creation and Data Literacy",
};

/** Foundations 固定桶 */
const FOUNDATIONS: { area: string; required: number }[] = [
  { area: "HMW", required: 3 },
  { area: "E-Comm", required: 6 },
  { area: "C-Comm", required: 3 },
];

/** Home Area 映射（program -> home areas），来自原 requirements.py */
const PROGRAM_HOME: Record<string, string[]> = {
  BCB: ["S"], BISC: ["S"], BIOT: ["S"], CHEM: ["S"], DASC: ["S"], MATH: ["S"], OST: ["S"], PHYS: ["S"],
  AE: ["T"], AI: ["T"], CIVL: ["T"], CPEG: ["T"], COMP: ["T"], DA: ["T"], ELEC: ["T"], IEEM: ["T"],
  MECH: ["T"], SUSEE: ["T"], MEIC: ["T"], COSC: ["T"],
  BIEN: ["S", "T"], CEEV: ["S", "T"], CENG: ["S", "T"], EEEN: ["S", "T"],
  ACCT: ["SA"], ECON: ["SA"], ECOF: ["SA"], FINA: ["SA"], GBM: ["SA"], GBUS: ["SA"], IS: ["SA"],
  MGMT: ["SA"], MARK: ["SA"], OM: ["SA"], QFIN: ["SA"], SGFN: ["SA"],
  GCS: ["H", "SA"], QSA: ["SA"],
  EVMT: ["SA"], ISDN: ["T"],
};

/** program -> school（Home Area 判定所需的学院归属） */
const PROGRAM_SCHOOL: Record<string, string> = Object.fromEntries(
  (
    [
      ["SSCI", ["BCB", "BISC", "BIOT", "CHEM", "DASC", "MATH", "OST", "PHYS"]],
      ["SENG", ["AE", "AI", "CIVL", "CPEG", "COMP", "DA", "ELEC", "IEEM", "MECH", "SUSEE", "MEIC", "COSC", "BIEN", "CEEV", "CENG", "EEEN"]],
      ["SBM", ["ACCT", "ECON", "ECOF", "FINA", "GBM", "GBUS", "IS", "MGMT", "MARK", "OM", "QFIN", "SGFN"]],
      ["SHSS", ["GCS", "QSA"]],
      ["AIS", ["EVMT", "ISDN"]],
    ] as [string, string[]][]
  ).flatMap(([school, programs]) => programs.map((p) => [p, school]))
);

/** 双 Home Area 的特殊 Program：非 Home 各 3 分 + 3 分任意 Area 槽 */
const DUAL_HOME_ANY = new Set(["BIEN", "CEEV", "CENG", "EEEN", "GCS"]);

const BROADENING_BASE = ["A", "H", "S", "T", "SA"];

/* ---------- 产物类型 ---------- */

export const CC_GROUP_NAMES: Record<string, string> = {
  Foundations: "基础",
  Broadening: "拓展",
  Experiencing: "体验",
};

export interface CommonCoreBucket {
  label: string;
  fullName: string;
  required: number;
  /** 已修（仅 taken） */
  takenCredits: number;
  /** 含计划（taken + planned，含替代后） */
  completedCredits: number;
  isElective: boolean;
  note?: string;
  /** 引擎实际计入本桶的课程（含计划口径；选修槽只含 Area 直属课） */
  counted?: { code: string; credits: number }[];
  /** 选修槽由溢出学分池替代的学分数（无法归属到具体课程） */
  substitutedCredits?: number;
}

export interface CommonCoreGroup {
  name: "Foundations" | "Broadening" | "Experiencing";
  buckets: CommonCoreBucket[];
  note?: string;
}

export interface CommonCoreAudit {
  groups: CommonCoreGroup[];
  totalRequired: number;
  totalTaken: number;
  totalCompleted: number;
  framework: { susApplicable: boolean; haicApplicable: boolean };
  /** 判定用学院（输入缺省时按 program 反查） */
  school?: string;
  /** 映射表未命中 / 无 Area 归属的课程 */
  unmatched: { code: string; status: CourseStatus }[];
}

export interface CommonCoreInput {
  courses: { code: string; status: CourseStatus }[];
  program: string;
  school?: string | null;
  /** 入学学年（如 "2024-25"），决定 SUS / HAIC 适用性 */
  admissionYear?: string | null;
}

/* ---------- 引擎 ---------- */

function yearStart(admissionYear?: string | null): number {
  const y = Number(admissionYear?.split("-")[0]);
  return Number.isFinite(y) ? y : 0;
}

interface Assigned {
  [area: string]: number;
}

interface AssignDetail {
  credits: Assigned;
  /** 每个 Area 实际分到的课程（贪心分配结果，多 Area 课程只归一处） */
  byArea: Record<string, { code: string; credits: number }[]>;
}

/** 把课程学分按 Area 分桶（多 Area 课程按「剩余需求最大」贪心归属，模拟学生自选） */
function assign(
  courses: { code: string; areas: string[]; credits: number }[],
  requiredByArea: Record<string, number>
): AssignDetail {
  const credits: Assigned = {};
  const byArea: AssignDetail["byArea"] = {};
  const put = (area: string, c: { code: string; credits: number }) => {
    credits[area] = (credits[area] ?? 0) + c.credits;
    (byArea[area] ??= []).push({ code: c.code, credits: c.credits });
  };
  const single = courses.filter((c) => c.areas.length === 1);
  const multi = courses
    .filter((c) => c.areas.length > 1)
    .sort((a, b) => a.areas.length - b.areas.length);
  for (const c of single) put(c.areas[0], c);
  for (const c of multi) {
    let best = c.areas[0];
    let bestRemain = -Infinity;
    for (const a of c.areas) {
      const remain = (requiredByArea[a] ?? 0) - (credits[a] ?? 0);
      if (remain > bestRemain) {
        bestRemain = remain;
        best = a;
      }
    }
    put(best, c);
  }
  return { credits, byArea };
}

export function schoolOf(program: string): string {
  return PROGRAM_SCHOOL[program] ?? "";
}

export function computeCommonCoreAudit(input: CommonCoreInput): CommonCoreAudit {
  const map = courseMapJson.courses as Record<
    string,
    { title: string; credits: number; areas: string[] }
  >;
  const y0 = yearStart(input.admissionYear);
  const susApplicable = y0 >= 2025;
  const haicApplicable = y0 >= 2026;
  const broadeningAreas = [
    ...BROADENING_BASE,
    ...(susApplicable ? ["SUS"] : []),
    ...(haicApplicable ? ["HAIC"] : []),
  ];

  const school = input.school || PROGRAM_SCHOOL[input.program] || "";
  const homeAreas = PROGRAM_HOME[input.program] ?? [];
  const requiredByArea: Record<string, number> = {};
  for (const f of FOUNDATIONS) requiredByArea[f.area] = f.required;
  requiredByArea.CTDL = 3;
  requiredByArea.UxOP = 3;
  for (const a of broadeningAreas) requiredByArea[a] = homeAreas.includes(a) ? 0 : 3;
  requiredByArea.HAIC = haicApplicable ? 3 : 0;

  // 课程分类：已映射（含多 Area）/ 未匹配
  const unmatched: { code: string; status: CourseStatus }[] = [];
  const takenCourses: { code: string; areas: string[]; credits: number }[] = [];
  const plannedCourses: { code: string; areas: string[]; credits: number }[] = [];
  const seen = new Set<string>();
  for (const { code, status } of input.courses) {
    if (seen.has(code)) continue;
    seen.add(code);
    const entry = map[code];
    if (!entry || entry.areas.length === 0) {
      unmatched.push({ code, status });
      continue;
    }
    const course = { code, areas: entry.areas, credits: entry.credits };
    (status === "taken" ? takenCourses : plannedCourses).push(course);
  }

  // 分桶：先只算 taken，再算 taken+planned（两组口径）
  const takenAssigned = assign(takenCourses, requiredByArea);
  const allAssigned = assign([...takenCourses, ...plannedCourses], requiredByArea);

  // 未占用学分池（修 ANY 槽 bug：只统计超出各桶要求的部分，HMW 溢出不可替代）
  const overflow = (assigned: Assigned) => {
    let pool = Math.max(0, (assigned["E-Comm"] ?? 0) - 6);
    pool += Math.max(0, (assigned["C-Comm"] ?? 0) - 3);
    for (const a of broadeningAreas) {
      if (!homeAreas.includes(a)) pool += Math.max(0, (assigned[a] ?? 0) - 3);
    }
    return pool;
  };
  const drawPool = (pool: number, own: number, required: number) => {
    const draw = Math.min(Math.max(0, required - own), Math.max(0, pool));
    return { completed: own + draw, remaining: pool - draw };
  };

  const mkBucket = (
    label: string,
    required: number,
    assignedTaken: AssignDetail,
    assignedAll: AssignDetail,
    opts?: { isElective?: boolean; note?: string }
  ): CommonCoreBucket => ({
    label,
    fullName: CC_AREA_NAMES[label] ?? label,
    required,
    takenCredits: Math.min(required, assignedTaken.credits[label] ?? 0),
    completedCredits: Math.min(required, assignedAll.credits[label] ?? 0),
    isElective: opts?.isElective ?? false,
    note: opts?.note,
    counted: assignedAll.byArea[label] ?? [],
  });

  const foundationBuckets = FOUNDATIONS.map((f) =>
    mkBucket(f.area, f.required, takenAssigned, allAssigned)
  );

  const broadeningBuckets = broadeningAreas
    .filter((a) => !homeAreas.includes(a))
    .map((a) =>
      mkBucket(a, 3, takenAssigned, allAssigned, {
        note: a === "SUS" ? "2025-26 起新增" : a === "HAIC" ? "2026-27 起新增" : undefined,
      })
    );

  if (DUAL_HOME_ANY.has(input.program)) {
    broadeningBuckets.push({
      label: "ANY",
      fullName: "Any Broadening Area",
      required: 3,
      takenCredits: Math.min(3, overflow(takenAssigned.credits)),
      completedCredits: Math.min(3, overflow(allAssigned.credits)),
      isElective: false,
      note: "任意非 Home Area 的未占用学分",
    });
  }

  // 选修替代：CTDL / UxOP 由未占用学分池顺序补足（先 CTDL 后 UxOP）
  const takenPool = overflow(takenAssigned.credits);
  const allPool = overflow(allAssigned.credits);
  const ctdlTaken = drawPool(takenPool, takenAssigned.credits.CTDL ?? 0, 3);
  const ctdlAll = drawPool(allPool, allAssigned.credits.CTDL ?? 0, 3);
  const uxopTaken = drawPool(ctdlTaken.remaining, takenAssigned.credits.UxOP ?? 0, 3);
  const uxopAll = drawPool(ctdlAll.remaining, allAssigned.credits.UxOP ?? 0, 3);
  const ctdlBucket: CommonCoreBucket = {
    label: "CTDL",
    fullName: CC_AREA_NAMES.CTDL,
    required: 3,
    takenCredits: ctdlTaken.completed,
    completedCredits: ctdlAll.completed,
    isElective: true,
    note: "选修槽：不足部分可由 E-Comm(高级)/C-Comm/A/H/S/T/SA/UxOP 未占用学分替代",
    counted: allAssigned.byArea.CTDL ?? [],
    substitutedCredits: ctdlAll.completed - (allAssigned.credits.CTDL ?? 0),
  };
  const uxopBucket: CommonCoreBucket = {
    label: "UxOP",
    fullName: CC_AREA_NAMES.UxOP,
    required: 3,
    takenCredits: uxopTaken.completed,
    completedCredits: uxopAll.completed,
    isElective: true,
    note: "选修槽：不足部分可由 CTDL/E-Comm(高级)/C-Comm/A/H/S/T/SA 未占用学分替代",
    counted: allAssigned.byArea.UxOP ?? [],
    substitutedCredits: uxopAll.completed - (allAssigned.credits.UxOP ?? 0),
  };

  const groups: CommonCoreGroup[] = [
    {
      name: "Foundations",
      buckets: [...foundationBuckets, ctdlBucket],
      note: "CTDL 选修槽可由其他通识桶未占用学分替代（以 AR 官网为准）",
    },
    {
      name: "Broadening",
      buckets: broadeningBuckets,
      note: `Home Area: ${homeAreas.length ? homeAreas.join(" / ") : "无"}；非 Home Area 各需 3 学分`,
    },
    {
      name: "Experiencing",
      buckets: [uxopBucket],
      note: "UxOP 选修槽可由其他通识桶未占用学分替代（以 AR 官网为准）",
    },
  ];

  const sumReq = (g: CommonCoreGroup) => g.buckets.reduce((s, b) => s + b.required, 0);
  const totalRequired = groups.reduce((s, g) => s + sumReq(g), 0);
  const totalTaken = groups.reduce(
    (s, g) => s + g.buckets.reduce((x, b) => x + b.takenCredits, 0),
    0
  );
  const totalCompleted = groups.reduce(
    (s, g) => s + g.buckets.reduce((x, b) => x + b.completedCredits, 0),
    0
  );

  return {
    groups,
    totalRequired,
    totalTaken,
    totalCompleted,
    framework: { susApplicable, haicApplicable },
    school: school || undefined,
    unmatched,
  };
}

/* ---------- 候选课程派生（供勾选 UI 使用） ---------- */

export interface CommonCoreCourseInfo {
  code: string;
  name: string;
  credits: number;
  areas: string[];
}

const CC_COURSES: CommonCoreCourseInfo[] = (
  Object.entries(courseMapJson.courses as Record<string, { title: string; credits: number; areas: string[] }>)
    .map(([code, e]) => ({ code, name: e.title, credits: e.credits, areas: e.areas ?? [] }))
).sort((a, b) => a.code.localeCompare(b.code));

/** 官方清单全部通识课程（含未归 Area 的条目） */
export function allCommonCoreCourses(): CommonCoreCourseInfo[] {
  return CC_COURSES;
}

/** 指定 Area 的候选课程（多 Area 课程会出现在每个所属 Area 的列表中） */
export function coursesForArea(area: string): CommonCoreCourseInfo[] {
  return CC_COURSES.filter((c) => c.areas.includes(area));
}

/** 选修槽（CTDL* / UxOP*）候选：全部通识课程（任何未占用学分均可替代） */
export function coursesForElectiveSlot(): CommonCoreCourseInfo[] {
  return CC_COURSES;
}


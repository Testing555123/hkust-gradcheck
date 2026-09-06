/**
 * 开发期假数据：真实库目前只有 2026-27 / ECON 一份培养方案，
 * 无法验证「多学年 / 多专业下拉、级联、失效重弹」等分支。
 * 开启方式：frontend/.env.local 写 VITE_USE_MOCK=1（该文件已被 .gitignore 忽略）。
 */

import type { ProgramInfo, ProgramTreeData } from "@/types";

export const MOCK_PROGRAMS: ProgramInfo[] = [
  { year: "2026-27", code: "ACCT", title: "BBA in Professional Accounting", total_required_credits: 120 },
  { year: "2026-27", code: "COMP", title: "BEng in Computer Science", total_required_credits: 120 },
  { year: "2026-27", code: "ECON", title: "BBA in Economics", total_required_credits: 120 },
  { year: "2026-27", code: "IS", title: "BBA in Information Systems", total_required_credits: 120 },
  { year: "2025-26", code: "COMP", title: "BEng in Computer Science", total_required_credits: 120 },
  { year: "2025-26", code: "FINA", title: "BBA in Finance", total_required_credits: 120 },
  { year: "2024-25", code: "COMP", title: "BEng in Computer Science", total_required_credits: 120 },
  { year: "2023-24", code: "ECON", title: "BBA in Economics", total_required_credits: 120 },
];

const key = (year: string, code: string) => `${year}/${code}`;

const MOCK_TREES: Record<string, ProgramTreeData> = {
  [key("2026-27", "COMP")]: {
    program: MOCK_PROGRAMS[1],
    groups: [
      {
        id: 1,
        name: "Major Requirements",
        required_credits: 63,
        min_courses: null,
        source_ref: "p.1",
        note: null,
        order_index: 0,
        courses: [
          { code: "COMP1023", name: "Introduction to Python Programming", credits: 3 },
          { code: "COMP2011", name: "Programming with C++", credits: 4 },
          { code: "COMP2012", name: "Object-Oriented Programming and Data Structures", credits: 4 },
          { code: "MATH1013", name: "Calculus I", credits: 3 },
          { code: "MATH2111", name: "Matrix Algebra and Applications", credits: 3 },
        ],
      },
      {
        id: 2,
        name: "Elective(s)",
        required_credits: 15,
        min_courses: 5,
        source_ref: "p.2",
        note: "Any 5 courses from the specified elective list, of which at least 3 courses should be taken from 1 area.",
        order_index: 1,
        courses: [
          { code: "COMP3021", name: "Database Management Systems", credits: 3, areas: ["Software / Database"] },
          { code: "COMP4331", name: "Distributed Systems", credits: 3, areas: ["Computer Systems / Networking"] },
          { code: "COMP4721", name: "Machine Learning", credits: 3, areas: ["Artificial Intelligence"] },
        ],
      },
    ],
  },
  [key("2026-27", "ECON")]: {
    program: MOCK_PROGRAMS[2],
    groups: [
      {
        id: 11,
        name: "Required Courses",
        required_credits: 12,
        min_courses: 3,
        source_ref: "p.1",
        note: null,
        order_index: 0,
        courses: [
          { code: "ECON3014", name: "Managerial Microeconomics", credits: 4 },
          { code: "ECON3024", name: "Managerial Macroeconomics", credits: 4 },
          { code: "ECON3334", name: "Introduction to Econometrics", credits: 4 },
        ],
      },
      {
        id: 12,
        name: "Elective(s)",
        required_credits: 11,
        min_courses: 3,
        source_ref: "p.1",
        note: "ECON 4000-level Electives (Any 3 courses of the subject and level as specified).",
        order_index: 1,
        courses: [{ code: "ECON4113", name: "Money and Banking", credits: 4 }],
      },
    ],
  },
};

/** 其余组合生成一份结构完整的兜底树，保证「弹窗选 mock 专业 → 主界面可渲染」整链可跑 */
function fallbackTree(year: string, code: string, program: ProgramInfo): ProgramTreeData {
  return {
    program,
    groups: [
      {
        id: 901,
        name: "Required Courses",
        required_credits: 12,
        min_courses: 4,
        source_ref: "p.1",
        note: null,
        order_index: 0,
        courses: [
          { code: `${code}2010`, name: `${code} Core Foundation I`, credits: 3 },
          { code: `${code}2020`, name: `${code} Core Foundation II`, credits: 3 },
          { code: `${code}3010`, name: `${code} Advanced Topics`, credits: 3 },
          { code: `${code}3020`, name: `${code} Capstone Seminar`, credits: 3 },
        ],
      },
      {
        id: 902,
        name: "Elective(s)",
        required_credits: 9,
        min_courses: 3,
        source_ref: "p.1",
        note: `Any 3 ${code} courses at 3000-level or above.`,
        order_index: 1,
        courses: [
          { code: `${code}3101`, name: `${code} Elective: Quantitative Methods`, credits: 3, areas: ["Methods"] },
          { code: `${code}3201`, name: `${code} Elective: Applied Practice`, credits: 3, areas: ["Practice"] },
          { code: `${code}3301`, name: `${code} Elective: Current Issues`, credits: 3 },
        ],
      },
    ],
  };
}

export function mockTreeFor(year: string, code: string): ProgramTreeData | null {
  const program = MOCK_PROGRAMS.find((p) => p.year === year && p.code === code);
  if (!program) return null;
  return MOCK_TREES[key(year, code)] ?? fallbackTree(year, code, program);
}

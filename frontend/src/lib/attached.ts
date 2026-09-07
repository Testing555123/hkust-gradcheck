/**
 * 附加方案（学院要求 / 辅修 / Extended Major）解析纯函数。
 *
 * 不依赖 React 与网络：输入 profile 选择 + 培养方案列表，
 * 输出应叠加展示的附加方案清单（含可用性降级标记）。
 */

import { schoolOf } from "@/lib/common-core";
import type { ProgramInfo } from "@/types";

export type AttachedKind = "minor" | "school" | "extm";

export interface AttachedProgram {
  year: string;
  /** MINOR-MATH / SREQ-SSCI / EXTM-AI */
  code: string;
  kind: AttachedKind;
  /** 展示用标签，如 "辅修：Minor Program in Mathematics" */
  label: string;
  /** 该学年是否有对应产物（false 时 UI 降级提示） */
  available: boolean;
}

/** 学院要求映射：仅这两个学院有官方 School Requirements PDF 数据 */
const SCHOOL_REQ: Record<string, string> = {
  SSCI: "SREQ-SSCI",
  SBM: "SREQ-SBM",
};

const SCHOOL_NAMES: Record<string, string> = {
  SSCI: "School of Science",
  SBM: "School of Business and Management",
};

export function schoolReqCode(school: string | null | undefined): string | null {
  if (!school) return null;
  return SCHOOL_REQ[school] ?? null;
}

function kindLabel(kind: AttachedKind, school?: string): string {
  if (kind === "school") {
    const name = school ? SCHOOL_NAMES[school] : undefined;
    return `学院要求${name ? `：${name}` : ""}`;
  }
  if (kind === "extm") return "Extended Major";
  return "辅修";
}

/**
 * 解析当前应叠加的附加方案：
 * - 学院要求：由主修自动推导（schoolOf 映射），学生不可自选学院；
 *   仅 SSCI / SBM 有数据，其它学院返回空（不显示学院要求区块）
 * - 辅修 / EXTM：来自 profile.minors 多选
 * - available=false 表示该学年无产物（UI 显示降级提示，不加载树）
 */
export function resolveAttachedPrograms(
  year: string,
  majorCode: string,
  minors: string[],
  programs: ProgramInfo[],
  schoolOverride?: string | null
): AttachedProgram[] {
  const out: AttachedProgram[] = [];
  const find = (code: string): ProgramInfo | undefined =>
    programs.find((p) => p.year === year && p.code === code);

  // 1. 学院要求（自动跟随主修；schoolOverride 优先于 schoolOf 反查）
  const school = schoolOverride || schoolOf(majorCode);
  const sreq = schoolReqCode(school);
  if (sreq) {
    const p = find(sreq);
    out.push({
      year,
      code: sreq,
      kind: "school",
      label: kindLabel("school", school),
      available: Boolean(p),
    });
  }

  // 2. 辅修 / Extended Major（用户多选）
  for (const code of minors) {
    const kind: AttachedKind = code.startsWith("EXTM-") ? "extm" : "minor";
    const p = find(code);
    out.push({
      year,
      code,
      kind,
      label: p ? `${kindLabel(kind)}：${p.title}` : kindLabel(kind),
      available: Boolean(p),
    });
  }

  return out;
}

/** 当前学年下可选的辅修 / EXTM 列表（Onboarding 多选数据源，按名称排序） */
export function selectableAttached(
  year: string,
  programs: ProgramInfo[]
): { code: string; title: string; kind: AttachedKind }[] {
  return programs
    .filter((p) => p.year === year && (p.code.startsWith("MINOR-") || p.code.startsWith("EXTM-")))
    .map((p) => ({
      code: p.code,
      title: p.title,
      kind: (p.code.startsWith("EXTM-") ? "extm" : "minor") as AttachedKind,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

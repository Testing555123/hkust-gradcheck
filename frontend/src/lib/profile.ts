/** 用户身份（入学信息）相关纯逻辑：不依赖 React，便于单测。 */

import type { ProgramInfo } from "@/types";

export interface Profile {
  /** 入学学年，如 "2026-27" */
  year: string;
  /** 主修代码，如 "ECON" */
  code: string;
  /** 学院：用于通识核心 Home Area 判定；可由 program 反查 */
  school: string | null;
  /** 通识框架判定的入学学年（Admit Date 推导，可能与 year 不同） */
  admissionYear: string | null;
  /** 辅修 / Extended Major：暂未开放，恒为空数组（结构留数组便于以后放开多选） */
  minors: string[];
  /** 最近一次写入时间（ISO 字符串），未选择过为 null */
  updatedAt: string | null;
}

export function emptyProfile(): Profile {
  return { year: "", code: "", school: null, admissionYear: null, minors: [], updatedAt: null };
}

/** 学年列表：去重 + 倒序（最新学年在前） */
export function yearsOf(programs: ProgramInfo[]): string[] {
  return Array.from(new Set(programs.map((p) => p.year))).sort().reverse();
}

/** 某学年下的培养方案：按专业代码升序 */
export function codesOf(programs: ProgramInfo[], year: string): ProgramInfo[] {
  return programs
    .filter((p) => p.year === year)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function findProgram(
  programs: ProgramInfo[],
  year: string,
  code: string
): ProgramInfo | undefined {
  return programs.find((p) => p.year === year && p.code === code);
}

/** profile 是否已经有值 */
export function hasProfile(profile: Profile | null | undefined): profile is Profile {
  return Boolean(profile && profile.year && profile.code);
}

/** profile 指向的方案是否仍存在于当前数据源中 */
export function isProfileValid(
  profile: Profile | null | undefined,
  programs: ProgramInfo[]
): boolean {
  if (!hasProfile(profile)) return false;
  return findProgram(programs, profile.year, profile.code) !== undefined;
}

/**
 * 是否需要弹出引导弹窗：
 * - 数据源为空时不弹（没有可选项，弹了也没得选，交由空态提示）
 * - profile 缺失或指向的方案已不存在时弹（后者为「失效重弹」）
 */
export function needsOnboarding(
  profile: Profile | null | undefined,
  programs: ProgramInfo[]
): boolean {
  if (programs.length === 0) return false;
  return !isProfileValid(profile, programs);
}

/**
 * 解析当前应展示的方案：profile 有效则用 profile，否则回退到最新学年的第一个专业。
 * 数据源为空时返回 null。
 */
export function resolveSelection(
  profile: Profile | null | undefined,
  programs: ProgramInfo[]
): { year: string; code: string } | null {
  if (programs.length === 0) return null;
  if (isProfileValid(profile, programs)) {
    return { year: profile!.year, code: profile!.code };
  }
  const fallback = codesOf(programs, yearsOf(programs)[0])[0];
  return { year: fallback.year, code: fallback.code };
}

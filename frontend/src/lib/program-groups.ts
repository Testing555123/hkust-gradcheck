/**
 * 培养方案分类纯逻辑：不依赖 React，便于单测。
 *
 * pipeline 产出 255 份方案，四类混在同一个 (year, code) 空间里，
 * 选择器需要按类别分组展示，否则 60+ 条目里主修与辅修无法区分。
 */

import type { ProgramInfo } from "@/types";

export type ProgramKind = "major" | "extm" | "minor" | "school";

/** 展示顺序：主修在前，学院要求最后（它是自动附加项，很少手动选） */
const KIND_ORDER: ProgramKind[] = ["major", "extm", "minor", "school"];

export const KIND_LABEL: Record<ProgramKind, string> = {
  major: "主修",
  extm: "Extended Major",
  minor: "辅修 Minor",
  school: "学院要求 School Requirements",
};

export function kindOf(code: string): ProgramKind {
  if (code.startsWith("EXTM-")) return "extm";
  if (code.startsWith("MINOR-")) return "minor";
  if (code.startsWith("SREQ-")) return "school";
  return "major";
}

export function isMajor(p: ProgramInfo): boolean {
  return kindOf(p.code) === "major";
}

/**
 * 把成绩单头部抽出的原始专业文本（可能含括号/Extended Major 描述）匹配到库内方案代码。
 *
 * 旧逻辑用「候选标题包含主修词根」的子串匹配，导致 "Mathematics (Statistics Track)"
 * 误命中 MAEC（Mathematics and Economics，标题也含 mathematics）并被按代码序取为首项。
 *
 * 新逻辑：归一化后做「候选标题每个内容词元都出现在成绩单主修文本中」的精确包含匹配。
 * - MAEC 标题含 economics，而成绩单主修文本无 economics → 被排除；
 * - MATH 标题仅 mathematics → 命中。
 * 命中按强度排序（精确相等 > 词元全包含），不再按代码字母序取首、也不做子串回退
 * （子串回退会重新引入 MAEC 这类「候选是成绩单超集」的误匹配）。
 * 返回全部命中代码（主修取首项，副修/EXTM 取多项用于预勾选）。无法识别返回空数组。
 */

/** 学位/类别前缀：匹配到标题开头时整体剔除，避免 "BSc in"/"Minor in" 干扰词元 */
const DEGREE_PREFIX_RE =
  /^(bachelor(?:'s)?\s+degree\s+in\s+|bachelor\s+of\s+(?:science|arts|engineering)\s+in\s+|bsc\s+in\s+|beng\s+in\s+|minor\s+(?:program\s+)?in\s+|extended\s+major\s+(?:program\s+)?in\s+|major\s+(?:program\s+)?in\s+)/i;
/** 标题内的停用词（剔除后只保留学科内容词元） */
const TITLE_STOP = new Set(["in", "of", "and", "the", "program", "for", "a"]);

/** 归一化标题：小写、去学位前缀、去括号 track、去标点、折叠空白 */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(DEGREE_PREFIX_RE, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 去除停用词后的内容词元集合 */
function titleTokens(s: string): Set<string> {
  return new Set(normalizeTitle(s).split(/\s+/).filter((t) => t && !TITLE_STOP.has(t)));
}

export function matchProgramsByTitle(
  raw: string | undefined,
  candidates: { code: string; title: string }[]
): string[] {
  if (!raw) return [];
  const rawNorm = normalizeTitle(raw.trim());
  if (!rawNorm) return [];
  const rawTokens = titleTokens(rawNorm);

  const scored = candidates
    .map((p) => {
      const cTokens = titleTokens(p.title);
      if (cTokens.size === 0) return null;
      // 候选标题的每个内容词元都必须出现在成绩单主修文本中（排除 MAEC 这类多词专业）
      const allIn = [...cTokens].every((t) => rawTokens.has(t));
      let score = 0;
      if (allIn) score = 2;
      if (normalizeTitle(p.title) === rawNorm) score = 3; // 精确相等优先级最高
      return score > 0 ? { code: p.code, score } : null;
    })
    .filter((x): x is { code: string; score: number } => x !== null);

  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return scored.map((s) => s.code);
}

/** 按代码/名称关键字过滤（大小写不敏感，空关键字原样返回） */
export function filterPrograms(list: ProgramInfo[], keyword: string): ProgramInfo[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return list;
  return list.filter(
    (p) =>
      p.code.toLowerCase().includes(kw) ||
      p.title.toLowerCase().includes(kw) ||
      KIND_LABEL[kindOf(p.code)].toLowerCase().includes(kw)
  );
}

export interface ProgramGroup {
  kind: ProgramKind;
  label: string;
  items: ProgramInfo[];
}

/** 按类别分组；只包含有内容的分组，顺序固定为 KIND_ORDER */
export function groupPrograms(list: ProgramInfo[], kinds?: ProgramKind[]): ProgramGroup[] {
  const allowed = kinds ?? KIND_ORDER;
  return KIND_ORDER.filter((k) => allowed.includes(k))
    .map((kind) => ({
      kind,
      label: KIND_LABEL[kind],
      items: list.filter((p) => kindOf(p.code) === kind),
    }))
    .filter((g) => g.items.length > 0);
}

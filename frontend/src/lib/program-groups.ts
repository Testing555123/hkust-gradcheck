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

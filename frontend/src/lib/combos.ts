import type {
  ComboGroup,
  ComboOption,
  ComboPart,
  CourseRef,
  CourseStatus,
  RequirementGroup,
} from "@/types";

/**
 * 组合规则（OR / AND）口径：把组内课程折叠成「有效课程」用于学分核算。
 *
 * 官方 Note 中的互斥备选（`MATH 2421 OR MATH 2431`）与捆绑
 * （`(COMP 2011 AND COMP 2012) OR COMP 2012H`）在数据里都是平铺的多门课，
 * 直接累加会把备选项重复计入、把捆绑的部分完成当成已得学分。
 *
 * 统一语义：
 * - part  = 一组「选一门」的备选（MATH1013 / MATH1023）
 * - option= 若干 part 的与（`A + B`，每个 part 都要）
 * - OR 组合 = 若干互斥 option，择其一；AND 组合 = 若干 part 都要
 *
 * 学分规则：
 * - 某 part 已修/计划 → 取该课；未选 → 取组内学分最高的一门（预估）
 * - 某 option 全部 part 已选 → 计各 part 所选学分之和
 * - 某 option 完全未选 → 按各 part 最高学分预估（与「未选取最高」一致）
 * - 某 option 部分完成 → 计 0（AND 意味着都要，部分完成不给学分）
 * - OR 组合取「可计入学分最大」的 option 作为代表；AND 组合各 part 都计
 */

interface PartState {
  /** 已选课程（已修优先于计划）；未选为 undefined */
  chosen?: ComboOption;
  /** 未选时的预估课程：组内学分最高的一门 */
  fallback: ComboOption;
}

function partState(part: ComboPart, status: Record<string, CourseStatus>): PartState {
  const chosen =
    part.courses.find((c) => status[c.code] === "taken") ??
    part.courses.find((c) => status[c.code] === "planned");
  const fallback = part.courses.reduce((best, c) => (c.credits > best.credits ? c : best));
  return { chosen, fallback };
}

interface OptionState {
  parts: PartState[];
  /** 每个 part 都已选 */
  complete: boolean;
  /** 完全没有勾选 */
  untouched: boolean;
  /** 可计入学分 */
  credits: number;
  /**
   * 代表优先级：已完成 2 > 部分完成 1 > 未选 0。
   * 先比档位再比学分——否则「已选一条路径」会被未选选项的更高预估盖掉。
   */
  rank: number;
}

function optionState(
  parts: ComboPart[],
  status: Record<string, CourseStatus>
): OptionState {
  const states = parts.map((p) => partState(p, status));
  const selected = states.filter((s) => s.chosen).length;
  const complete = selected === states.length;
  const untouched = selected === 0;
  const credits = complete
    ? states.reduce((sum, s) => sum + (s.chosen?.credits ?? 0), 0)
    : untouched
      ? states.reduce((sum, s) => sum + s.fallback.credits, 0)
      : 0; // 部分完成：AND 意味着都要，未齐不给学分
  return { parts: states, complete, untouched, credits, rank: complete ? 2 : untouched ? 0 : 1 };
}

function better(a: OptionState, b: OptionState): OptionState {
  if (b.rank !== a.rank) return b.rank > a.rank ? b : a;
  return b.credits > a.credits ? b : a;
}

/** OR 组合当前的代表选项：已完成 > 部分完成 > 未选预估，同级比学分 */
function bestOption(combo: Extract<ComboGroup, { kind: "or" }>, status: Record<string, CourseStatus>) {
  let best: OptionState | null = null;
  for (const option of combo.options) {
    const state = optionState(option.parts, status);
    best = best ? better(best, state) : state;
  }
  return best;
}

/** 该组合当前计入的学分（UI「计 N 学分」用） */
export function comboCredits(
  combo: ComboGroup,
  status: Record<string, CourseStatus>
): number {
  if (combo.kind === "and") {
    return combo.parts.reduce((sum, part) => {
      const state = partState(part, status);
      return sum + (state.chosen ?? state.fallback).credits;
    }, 0);
  }
  return bestOption(combo, status)?.credits ?? 0;
}

/** 该组合是否已完成（用于 UI 高亮） */
export function isComboComplete(
  combo: ComboGroup,
  status: Record<string, CourseStatus>
): boolean {
  if (combo.kind === "and") {
    return combo.parts.every((part) => partState(part, status).chosen);
  }
  return Boolean(bestOption(combo, status)?.complete);
}

/** 组合参与组内核算的课程（代表课 / 缺口课） */
function comboCourses(
  combo: ComboGroup,
  status: Record<string, CourseStatus>
): CourseRef[] {
  const toRef = (o: ComboOption): CourseRef => ({
    code: o.code,
    name: o.name,
    credits: o.credits,
  });

  if (combo.kind === "and") {
    // 纯捆绑：各 part 都要，所选优先、未选取预估课（学分口径与平铺一致）
    return combo.parts.map((part) => {
      const state = partState(part, status);
      return toRef(state.chosen ?? state.fallback);
    });
  }

  const best = bestOption(combo, status);
  if (!best) return [];
  if (best.complete) return best.parts.map((p) => toRef(p.chosen as ComboOption));
  if (best.untouched) return best.parts.map((p) => toRef(p.fallback));
  // 部分完成：只把未选的 part 作为缺口列出，已选部分不计分
  return best.parts.filter((p) => !p.chosen).map((p) => toRef(p.fallback));
}

/** 组合内「当前计入」的课号（已选优先、未选取预估课）：供 UI 高亮代表项 */
export function comboActiveCodes(
  combo: ComboGroup,
  status: Record<string, CourseStatus>
): Set<string> {
  const codes = new Set<string>();
  if (combo.kind === "and") {
    for (const part of combo.parts) {
      const state = partState(part, status);
      codes.add((state.chosen ?? state.fallback).code);
    }
    return codes;
  }
  // OR：只高亮代表选项（未选 part 用预估课）
  const best = bestOption(combo, status);
  for (const state of best?.parts ?? []) {
    codes.add((state.chosen ?? state.fallback).code);
  }
  return codes;
}

/** 已归入组合的课号集合：渲染时据此过滤平铺课程行，避免同一门课出现两次 */
export function comboCodes(group: RequirementGroup): Set<string> {
  const codes = new Set<string>();
  for (const combo of group.combos ?? []) {
    const parts = combo.kind === "and" ? combo.parts : combo.options.flatMap((o) => o.parts);
    for (const part of parts) {
      for (const course of part.courses) {
        codes.add(course.code);
      }
    }
  }
  return codes;
}

/**
 * 组内用于学分核算的「有效课程」：非组合课 + 各组合的代表课。
 * 无组合的组原样返回 group.courses（引用不变，避免无谓重渲染）。
 */
export function effectiveCourses(
  group: RequirementGroup,
  status: Record<string, CourseStatus>
): CourseRef[] {
  const combos = group.combos ?? [];
  if (combos.length === 0) return group.courses;

  const inCombo = comboCodes(group);
  const out: CourseRef[] = group.courses
    .filter((c) => !inCombo.has(c.code))
    .map((c) => ({ ...c }));

  for (const combo of combos) {
    out.push(...comboCourses(combo, status));
  }
  return out;
}

/** 组合占用几门课的名额：OR 取选项中的最大 part 数，AND 取 part 数 */
export function comboCourseCount(combo: ComboGroup): number {
  if (combo.kind === "and") return combo.parts.length;
  return combo.options.reduce((max, o) => Math.max(max, o.parts.length), 0);
}

/** 组内有效门数（组合按其占用名额计）：用于「共 N 门课」这类展示口径 */
export function effectiveCourseCount(group: RequirementGroup): number {
  const combos = group.combos ?? [];
  if (combos.length === 0) return group.courses.length;
  const comboCount = combos.reduce((sum, c) => sum + comboCourseCount(c), 0);
  return group.courses.length - comboCodes(group).size + comboCount;
}

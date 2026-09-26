import { describe, expect, it } from "vitest";

import {
  codesOf,
  emptyProfile,
  isProfileValid,
  needsOnboarding,
  resolveSelection,
  yearsOf,
} from "./profile";
import type { ProgramInfo } from "../types";

const P = (year: string, code: string, title = `${code} Program`): ProgramInfo => ({
  year,
  code,
  title,
  total_required_credits: 120,
});

const programs: ProgramInfo[] = [
  P("2025-26", "MATH"),
  P("2026-27", "ECON"),
  P("2026-27", "COMP"),
  P("2026-27", "ACCT"),
  P("2025-26", "COMP"),
];

describe("yearsOf / codesOf", () => {
  it("学年去重并倒序（最新在前）", () => {
    expect(yearsOf(programs)).toEqual(["2026-27", "2025-26"]);
    expect(yearsOf([P("2026-27", "A"), P("2026-27", "B")])).toEqual(["2026-27"]);
  });

  it("按学年过滤并按专业代码升序", () => {
    expect(codesOf(programs, "2026-27").map((p) => p.code)).toEqual(["ACCT", "COMP", "ECON"]);
    expect(codesOf(programs, "2024-25")).toEqual([]);
  });
});

describe("isProfileValid", () => {
  it("未选择 / 空 profile 无效", () => {
    expect(isProfileValid(null, programs)).toBe(false);
    expect(isProfileValid(emptyProfile(), programs)).toBe(false);
  });

  it("命中当前数据源才有效", () => {
    expect(isProfileValid({ ...emptyProfile(), year: "2026-27", code: "ECON" }, programs)).toBe(
      true
    );
    // 同 code 但学年不存在
    expect(isProfileValid({ ...emptyProfile(), year: "2024-25", code: "ECON" }, programs)).toBe(
      false
    );
  });
});

describe("needsOnboarding", () => {
  it("数据源为空时不弹窗（交给空态提示）", () => {
    expect(needsOnboarding(null, [])).toBe(false);
    expect(needsOnboarding({ ...emptyProfile(), year: "2026-27", code: "ECON" }, [])).toBe(false);
  });

  it("profile 缺失 → 需要引导", () => {
    expect(needsOnboarding(null, programs)).toBe(true);
  });

  it("profile 指向的方案已下线 → 失效重弹", () => {
    expect(
      needsOnboarding({ ...emptyProfile(), year: "2023-24", code: "COMP" }, programs)
    ).toBe(true);
  });

  it("profile 有效 → 不弹窗", () => {
    expect(
      needsOnboarding({ ...emptyProfile(), year: "2025-26", code: "MATH" }, programs)
    ).toBe(false);
  });
});

describe("resolveSelection", () => {
  it("数据源为空 → null", () => {
    expect(resolveSelection(null, [])).toBeNull();
  });

  it("profile 有效 → 用 profile", () => {
    expect(
      resolveSelection({ ...emptyProfile(), year: "2025-26", code: "MATH" }, programs)
    ).toEqual({ year: "2025-26", code: "MATH" });
  });

  it("profile 失效 → 回退到最新学年的第一个专业", () => {
    expect(
      resolveSelection({ ...emptyProfile(), year: "2023-24", code: "COMP" }, programs)
    ).toEqual({ year: "2026-27", code: "ACCT" });
    expect(resolveSelection(null, programs)).toEqual({ year: "2026-27", code: "ACCT" });
  });
});

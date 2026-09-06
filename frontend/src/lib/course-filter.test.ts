import { describe, expect, it } from "vitest";

import { applyFilter, attachStatus, countByStatus } from "./course-filter";
import type { FlatCourseWithStatus } from "./course-filter";

const C = (code: string, status?: "taken" | "planned"): FlatCourseWithStatus => ({
  code,
  name: `Course ${code}`,
  credits: 3,
  groupNames: ["Required"],
  status,
});

const raw = [C("COMP1023"), C("COMP2011"), C("COMP2012")];
const status = { COMP1023: "taken", COMP2011: "planned" } as const;

describe("attachStatus", () => {
  it("把全局勾选状态附加到课程（不改入参）", () => {
    const out = attachStatus(raw, status);
    expect(out.map((c) => c.status)).toEqual(["taken", "planned", undefined]);
    expect(raw[0].status).toBeUndefined(); // 入参未被修改
  });
});

describe("applyFilter", () => {
  const courses = attachStatus(raw, status);

  it("all 返回全部", () => {
    expect(applyFilter(courses, "all")).toHaveLength(3);
  });

  it("taken / planned 按状态过滤", () => {
    expect(applyFilter(courses, "taken").map((c) => c.code)).toEqual(["COMP1023"]);
    expect(applyFilter(courses, "planned").map((c) => c.code)).toEqual(["COMP2011"]);
  });

  it("none = 未勾选", () => {
    expect(applyFilter(courses, "none").map((c) => c.code)).toEqual(["COMP2012"]);
  });
});

describe("countByStatus", () => {
  it("各状态计数之和等于总数", () => {
    const counts = countByStatus(attachStatus(raw, status));
    expect(counts).toEqual({ all: 3, taken: 1, planned: 1, none: 1 });
    expect(counts.taken + counts.planned + counts.none).toBe(counts.all);
  });

  it("空列表全为 0", () => {
    expect(countByStatus([])).toEqual({ all: 0, taken: 0, planned: 0, none: 0 });
  });
});

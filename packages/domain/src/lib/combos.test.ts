import { describe, expect, it } from "vitest";

import {
  comboActiveCodes,
  comboCodes,
  comboCourseCount,
  comboCredits,
  effectiveCourseCount,
  effectiveCourses,
  isComboComplete,
} from "./combos";
import type { ComboGroup, CourseStatus, RequirementGroup } from "../types";

function course(code: string, credits: number) {
  return { code, name: `Course ${code}`, credits };
}

function group(courses: [string, number][], combos?: ComboGroup[]): RequirementGroup {
  return {
    id: 1,
    name: "Required Course(s)",
    required_credits: 29,
    min_courses: null,
    source_ref: "p.2",
    note: null,
    order_index: 1,
    courses: courses.map(([code, credits]) => course(code, credits)),
    combos,
  };
}

const status = (o: Record<string, CourseStatus>): Record<string, CourseStatus> => o;

// A OR B：两个互斥选项，各一个 part
const orPair: ComboGroup = {
  kind: "or",
  options: [
    { parts: [{ courses: [course("MATH2421", 4)] }] },
    { parts: [{ courses: [course("MATH2431", 4)] }] },
  ],
};

// (COMP2011 AND COMP2012) OR COMP2012H：选项一是两门课的捆绑
const orBundle: ComboGroup = {
  kind: "or",
  options: [
    {
      parts: [{ courses: [course("COMP2011", 4)] }, { courses: [course("COMP2012", 3)] }],
    },
    { parts: [{ courses: [course("COMP2012H", 5)] }] },
  ],
};

// [(MATH1013 OR MATH1023) AND (MATH1014 OR MATH1024)] OR [MATH1020]
const nested: ComboGroup = {
  kind: "or",
  options: [
    {
      parts: [
        { courses: [course("MATH1013", 3), course("MATH1023", 3)] },
        { courses: [course("MATH1014", 3), course("MATH1024", 3)] },
      ],
    },
    { parts: [{ courses: [course("MATH1020", 5)] }] },
  ],
};

// 纯 AND：COMP2011 AND COMP2012 都要
const andPair: ComboGroup = {
  kind: "and",
  parts: [{ courses: [course("COMP2011", 4)] }, { courses: [course("COMP2012", 3)] }],
};

describe("comboCredits（OR）", () => {
  it("未选时按最高学分预估", () => {
    expect(comboCredits(orPair, status({}))).toBe(4);
  });

  it("选择某选项即按该课计分", () => {
    expect(comboCredits(orPair, status({ MATH2431: "taken" }))).toBe(4);
  });

  it("捆绑未选时按各 part 最高之和预估", () => {
    expect(comboCredits(orBundle, status({}))).toBe(7); // 4 + 3
  });

  it("捆绑全部完成才计满", () => {
    expect(comboCredits(orBundle, status({ COMP2011: "taken", COMP2012: "taken" }))).toBe(7);
  });

  it("捆绑部分完成计 0", () => {
    expect(comboCredits(orBundle, status({ COMP2011: "taken" }))).toBe(0);
  });

  it("嵌套：代表选项取可计入学分最大者", () => {
    expect(comboCredits(nested, status({}))).toBe(6); // 3+3 > 5
    expect(comboCredits(nested, status({ MATH1020: "taken" }))).toBe(5);
    expect(comboCredits(nested, status({ MATH1013: "taken", MATH1024: "taken" }))).toBe(6);
  });
});

describe("comboCredits（AND）", () => {
  it("两门都要：未选也按两门之和", () => {
    expect(comboCredits(andPair, status({}))).toBe(7);
    expect(comboCredits(andPair, status({ COMP2011: "taken" }))).toBe(7);
  });
});

describe("isComboComplete", () => {
  it("OR：任一选项完整即完成", () => {
    expect(isComboComplete(orPair, status({ MATH2421: "taken" }))).toBe(true);
    expect(isComboComplete(orPair, status({}))).toBe(false);
  });

  it("OR 捆绑：部分完成不算完成", () => {
    expect(isComboComplete(orBundle, status({ COMP2011: "taken" }))).toBe(false);
    expect(isComboComplete(orBundle, status({ COMP2011: "taken", COMP2012: "planned" }))).toBe(
      true
    );
    expect(isComboComplete(orBundle, status({ COMP2012H: "taken" }))).toBe(true);
  });

  it("AND：全部 part 都要选", () => {
    expect(isComboComplete(andPair, status({ COMP2011: "taken" }))).toBe(false);
    expect(isComboComplete(andPair, status({ COMP2011: "taken", COMP2012: "taken" }))).toBe(true);
  });
});

describe("effectiveCourses", () => {
  it("无组合时原样返回 group.courses", () => {
    const g = group([["MATH2411", 4]]);
    expect(effectiveCourses(g, status({}))).toBe(g.courses);
  });

  it("每个组合只贡献一个选项的课，消除重复计分", () => {
    const g = group(
      [
        ["MATH2411", 4],
        ["MATH2421", 4],
        ["MATH2431", 4],
        ["MATH3423", 3],
      ],
      [orPair]
    );
    const eff = effectiveCourses(g, status({}));
    expect(eff.map((c) => c.code)).toEqual(["MATH2411", "MATH3423", "MATH2421"]);
    expect(eff.reduce((a, c) => a + c.credits, 0)).toBe(11); // 平铺为 15
  });

  it("捆绑全部完成时贡献多门课", () => {
    const g = group(
      [
        ["COMP2011", 4],
        ["COMP2012", 3],
        ["COMP2012H", 5],
      ],
      [orBundle]
    );
    const eff = effectiveCourses(g, status({ COMP2011: "taken", COMP2012: "taken" }));
    expect(eff.map((c) => c.code).sort()).toEqual(["COMP2011", "COMP2012"]);
  });

  it("捆绑部分完成：代表仍是该捆绑，只列未选 part 作为缺口且不计分", () => {
    const g = group([["COMP2011", 4], ["COMP2012", 3], ["COMP2012H", 5]], [orBundle]);
    // 已选一条路径（rank 更高）优先于未选选项的更高预估：代表 = 捆绑，计 0 分
    const eff = effectiveCourses(g, status({ COMP2011: "taken" }));
    expect(eff.map((c) => c.code)).toEqual(["COMP2012"]);
  });

  it("纯 AND 组合贡献全部课程（学分口径与平铺一致）", () => {
    const g = group([["COMP2011", 4], ["COMP2012", 3], ["COMP3000", 3]], [andPair]);
    const eff = effectiveCourses(g, status({}));
    expect(eff.map((c) => c.code)).toEqual(["COMP3000", "COMP2011", "COMP2012"]);
    expect(eff.reduce((a, c) => a + c.credits, 0)).toBe(10);
  });
});

describe("comboCodes / 门数", () => {
  const g = group([["MATH2421", 4], ["MATH2431", 4], ["MATH2411", 4]], [orPair]);

  it("收集组合内的课号，供渲染去重", () => {
    expect([...comboCodes(g)].sort()).toEqual(["MATH2421", "MATH2431"]);
    expect([...comboActiveCodes(orPair, status({ MATH2431: "taken" }))]).toEqual(["MATH2431"]);
  });

  it("有效门数：OR 组合占 1 门，AND 捆绑占 part 数", () => {
    expect(comboCourseCount(orPair)).toBe(1);
    expect(comboCourseCount(orBundle)).toBe(2);
    expect(comboCourseCount(andPair)).toBe(2);
    expect(effectiveCourseCount(g)).toBe(2); // 1 门非组合课 + 1 个组合
  });
});

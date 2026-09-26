import { describe, expect, it } from "vitest";
import { computeGroupAudit, computeProgramAudit } from "./audit";
import type { CourseRef, RequirementGroup } from "../types";

function course(code: string, credits: number): CourseRef {
  return { code, name: `Course ${code}`, credits };
}

function group(
  id: string,
  name: string,
  requiredCredits: number,
  courses: CourseRef[]
): RequirementGroup {
  return {
    id: 0,
    name,
    required_credits: requiredCredits,
    courses,
    order_index: 0,
  };
}

describe("computeGroupAudit", () => {
  const g = group("g1", "Required", 12, [
    course("A1", 3),
    course("A2", 4),
    course("A3", 5),
    course("A4", 6),
  ]);

  it("空勾选：全部是缺口", () => {
    const a = computeGroupAudit(g, {});
    expect(a.takenCredits).toBe(0);
    expect(a.plannedCredits).toBe(0);
    expect(a.remaining).toBe(12);
    expect(a.missingCourses).toHaveLength(4);
    expect(a.isDone).toBe(false);
  });

  it("已修学分即时计入进度", () => {
    const a = computeGroupAudit(g, { A1: "taken" });
    expect(a.takenCredits).toBe(3);
    expect(a.percentTaken).toBe(25); // 3/12
    expect(a.percentPlanned).toBe(25);
    // 缺口按学分从大到小：A4(6) 优先于 A2(4)
    expect(a.missingCourses.map((c) => c.code)).toEqual(["A4", "A3", "A2"]);
  });

  it("计划建立在已修之上", () => {
    const a = computeGroupAudit(g, { A1: "taken", A2: "planned" });
    expect(a.takenCredits).toBe(3);
    expect(a.plannedCredits).toBe(7); // 3 + 4
    expect(a.percentPlanned).toBeCloseTo((7 / 12) * 100, 5);
    expect(a.remaining).toBe(5);
  });

  it("超修学分封顶计算百分比", () => {
    const a = computeGroupAudit(g, { A4: "taken" }); // 6 分
    const b = computeGroupAudit(g, { A3: "taken", A4: "taken" }); // 11 分
    expect(a.percentTaken).toBe(50);
    expect(b.percentTaken).toBeCloseTo((11 / 12) * 100, 5);
  });

  it("已修达标即 isDone", () => {
    const a = computeGroupAudit(g, { A1: "taken", A2: "taken", A3: "taken", A4: "taken" });
    expect(a.takenCredits).toBe(18); // 超过 12
    expect(a.isDone).toBe(true);
    expect(a.percentTaken).toBe(100);
    expect(a.remaining).toBe(0);
  });

  it("缺口课程按学分从大到小排序", () => {
    const a = computeGroupAudit(g, { A1: "taken" });
    const credits = a.missingCourses.map((c) => c.credits);
    expect(credits).toEqual([...credits].sort((x, y) => y - x));
    expect(credits[0]).toBe(6); // A4 优先
  });

  it("required=0 组不产生除零", () => {
    const free = group("g0", "Free", 0, [course("X1", 3)]);
    const a = computeGroupAudit(free, {});
    expect(a.percentTaken).toBe(0);
    const b = computeGroupAudit(free, { X1: "taken" });
    expect(b.percentTaken).toBe(100);
  });

  describe("OR 组合（二选一）口径", () => {
    // 官方 Note: MATH 2421 OR MATH 2431 / MATH 4424 OR MATH 4425
    const combo: RequirementGroup["combos"] = [
      {
        kind: "or",
        options: [
          { parts: [{ courses: [{ code: "MATH2421", name: "Probability", credits: 4 }] }] },
          {
            parts: [
              { courses: [{ code: "MATH2431", name: "Honors Probability", credits: 4 }] },
            ],
          },
        ],
      },
      {
        kind: "or",
        options: [
          {
            parts: [
              { courses: [{ code: "MATH4424", name: "Multivariate Analysis", credits: 3 }] },
            ],
          },
          {
            parts: [
              {
                courses: [
                  { code: "MATH4425", name: "Introductory Time Series", credits: 3 },
                ],
              },
            ],
          },
        ],
      },
    ];
    const orGroup: RequirementGroup = {
      ...group("or", "Track Required", 29, [
        course("MATH2411", 4),
        course("MATH2421", 4),
        course("MATH2431", 4),
        course("MATH4424", 3),
        course("MATH4425", 3),
      ]),
      combos: combo,
    };

    it("备选项不重复累加：未选时按每个组合的最高学分计一门", () => {
      const a = computeGroupAudit(orGroup, {});
      // 平铺累加为 18，组合口径只应算 4 + 4 + 3
      expect(a.takenCredits).toBe(0);
      expect(a.missingCourses).toHaveLength(3);
      expect(a.missingCourses.reduce((s, c) => s + c.credits, 0)).toBe(11);
    });

    it("勾选备选中的一门即按该门计入学分", () => {
      const a = computeGroupAudit(orGroup, { MATH2421: "taken" });
      expect(a.takenCredits).toBe(4);
      expect(a.missingCourses.map((c) => c.code)).toContain("MATH4424");
      expect(a.missingCourses).toHaveLength(2);
    });

    it("同一组合内勾选两门也只算一门", () => {
      const a = computeGroupAudit(orGroup, { MATH2421: "taken", MATH2431: "taken" });
      expect(a.takenCredits).toBe(4);
    });
  });
});

describe("computeProgramAudit", () => {
  const groups = [
    group("g1", "Core", 10, [course("A1", 4), course("A2", 6)]),
    group("g2", "Elective", 6, [course("B1", 3), course("B2", 3)]),
  ];

  it("跨组汇总学分与百分比", () => {
    const a = computeProgramAudit(groups, { A1: "taken" });
    expect(a.totalRequired).toBe(16);
    expect(a.totalTaken).toBe(4);
    expect(a.percentTaken).toBe(25);
    expect(a.groups).toHaveLength(2);
  });

  it("每组的超出部分不夸大总进度", () => {
    // g1 全修 10 分（超 0），g2 全修 6 分 -> 正好 100%
    const a = computeProgramAudit(groups, {
      A1: "taken",
      A2: "taken",
      B1: "taken",
      B2: "taken",
    });
    expect(a.totalTaken).toBe(16);
    expect(a.percentTaken).toBe(100);
    expect(a.remaining).toBe(0);
  });

  it("计划后缺口正确累计", () => {
    const a = computeProgramAudit(groups, { A1: "taken", A2: "planned" });
    expect(a.totalPlanned).toBe(10); // g1 覆盖满
    expect(a.remaining).toBe(6); // g2 未安排
  });
});

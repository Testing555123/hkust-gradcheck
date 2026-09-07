import { describe, expect, it } from "vitest";

import {
  allCommonCoreCourses,
  computeCommonCoreAudit,
  coursesForArea,
  coursesForElectiveSlot,
} from "./common-core";

const course = (code: string, status: "taken" | "planned" = "taken") => ({ code, status });

const base = { program: "COMP", school: "SENG", admissionYear: "2023-24" };
const find = (audit: ReturnType<typeof computeCommonCoreAudit>, group: string, label: string) =>
  audit.groups.find((g) => g.name === group)!.buckets.find((b) => b.label === label)!;

describe("computeCommonCoreAudit / 框架与结构", () => {
  it("空课程：COMP 2023-24 基础框架（无 SUS，Home Area T 不设桶）", () => {
    const a = computeCommonCoreAudit({ courses: [], ...base });
    expect(a.framework).toEqual({ susApplicable: false, haicApplicable: false });
    expect(a.groups.map((g) => g.name)).toEqual(["Foundations", "Broadening", "Experiencing"]);
    const broad = a.groups[1].buckets.map((b) => b.label);
    expect(broad).toEqual(["A", "H", "S", "SA"]); // Home T 无桶
    expect(a.totalRequired).toBe(30); // 12 foundations + 12 broadening + 6 electives
    expect(a.totalCompleted).toBe(0);
  });

  it("2025-26 入学启用 SUS，2026-27 启用 HAIC", () => {
    const a25 = computeCommonCoreAudit({ courses: [], ...base, admissionYear: "2025-26" });
    expect(a25.groups[1].buckets.map((b) => b.label)).toContain("SUS");
    expect(a25.totalRequired).toBe(33);
    const a26 = computeCommonCoreAudit({ courses: [], ...base, admissionYear: "2026-27" });
    expect(a26.groups[1].buckets.map((b) => b.label)).toEqual(["A", "H", "S", "SA", "SUS", "HAIC"]);
  });

  it("school 缺省时按 program 反查", () => {
    const a = computeCommonCoreAudit({ courses: [], program: "COMP", admissionYear: "2023-24" });
    expect(a.school).toBe("SENG");
  });
});

describe("computeCommonCoreAudit / 桶分配", () => {
  it("Foundations 三桶按课号映射计入", () => {
    const a = computeCommonCoreAudit({
      courses: [course("HMAW1905"), course("LANG1402"), course("LANG1416")],
      ...base,
    });
    expect(find(a, "Foundations", "HMW").completedCredits).toBe(3);
    expect(find(a, "Foundations", "E-Comm").completedCredits).toBe(3);
    expect(find(a, "Foundations", "C-Comm").completedCredits).toBe(3);
  });

  it("E-Comm 6 学分要求，超出部分进溢出池而非桶内", () => {
    const a = computeCommonCoreAudit({
      courses: [course("LANG1402"), course("LANG1403"), course("LANG1409")],
      ...base,
    });
    const e = find(a, "Foundations", "E-Comm");
    expect(e.completedCredits).toBe(6); // 9 学分只计 6
    // 溢出 3 分自动替代 CTDL 选修槽
    expect(find(a, "Foundations", "CTDL").completedCredits).toBe(3);
  });

  it("多 Area 课程按剩余需求贪心归属（ISOM2400: T/SA，COMP 下归 SA）", () => {
    const a = computeCommonCoreAudit({ courses: [course("ISOM2400")], ...base });
    expect(find(a, "Broadening", "SA").completedCredits).toBe(3);
    // BIEN（Home S+T，非 Home A/H/SA）：ISOM2400 归 SA 之外还可归 T（溢出）
    const b = computeCommonCoreAudit({ courses: [course("ISOM2400")], program: "BIEN", school: "SENG", admissionYear: "2023-24" });
    // T 是 Home（无桶），SA 非桶外剩余需求 3 → 归 SA
    expect(find(b, "Broadening", "SA").completedCredits).toBe(3);
  });
});

describe("computeCommonCoreAudit / ANY 槽（unused-credits 修复）", () => {
  it("BIEN：非 Home 桶 A/H 各 3 + 溢出 3 计入 ANY，不重复计数", () => {
    // A 6 学分（超出要求 3 → 溢出 3）、H 3、SA 3
    const a = computeCommonCoreAudit({
      courses: [
        course("AMCC2010"),
        course("AMCC2020"),
        course("HUMA1010"),
        course("ACCT1010"),
      ],
      program: "BIEN",
      school: "SENG",
      admissionYear: "2023-24",
    });
    expect(find(a, "Broadening", "A").completedCredits).toBe(3); // 截断
    expect(find(a, "Broadening", "H").completedCredits).toBe(3);
    expect(find(a, "Broadening", "SA").completedCredits).toBe(3);
    expect(find(a, "Broadening", "ANY").completedCredits).toBe(3); // A 的溢出 3
  });

  it("无溢出时 ANY 为 0（不把已计入的学分二次计入）", () => {
    const a = computeCommonCoreAudit({
      courses: [course("AMCC2010"), course("HUMA1010"), course("ACCT1010")],
      program: "BIEN",
      school: "SENG",
      admissionYear: "2023-24",
    });
    expect(find(a, "Broadening", "ANY").completedCredits).toBe(0);
  });
});

describe("computeCommonCoreAudit / UxOP 替代与未匹配", () => {
  it("UxOP 自身课程计入（UROP 为 1 学分，缺口留给替代池）", () => {
    const a = computeCommonCoreAudit({
      courses: [course("UROP3200")],
      ...base,
    });
    expect(find(a, "Experiencing", "UxOP").completedCredits).toBe(1);
  });

  it("UxOP 可由溢出池替代（E-Comm 15 → 溢出 9：补 CTDL 3 后剩 6，连同自身 1 分补满 UxOP 3）", () => {
    const a = computeCommonCoreAudit({
      courses: [
        course("LANG1402"),
        course("LANG1403"),
        course("LANG1409"),
        course("LANG1404"),
        course("LANG1406"),
        course("UROP3200"),
      ],
      ...base,
    });
    expect(find(a, "Foundations", "E-Comm").completedCredits).toBe(6);
    expect(find(a, "Foundations", "CTDL").completedCredits).toBe(3);
    expect(find(a, "Experiencing", "UxOP").completedCredits).toBe(3);
  });

  it("映射表未命中课程进 unmatched 且不影响桶", () => {
    const a = computeCommonCoreAudit({
      courses: [course("MATH1013"), course("HMAW1905")],
      ...base,
    });
    expect(a.unmatched.map((u) => u.code)).toEqual(["MATH1013"]);
    expect(find(a, "Foundations", "HMW").completedCredits).toBe(3);
  });

  it("planned 课程计入含计划口径但不计入已修", () => {
    const a = computeCommonCoreAudit({
      courses: [course("HMAW1905", "taken"), course("LANG1402", "planned")],
      ...base,
    });
    expect(find(a, "Foundations", "HMW").takenCredits).toBe(3);
    expect(find(a, "Foundations", "E-Comm").takenCredits).toBe(0);
    expect(find(a, "Foundations", "E-Comm").completedCredits).toBe(3);
    expect(a.totalTaken).toBe(3);
    expect(a.totalCompleted).toBe(6);
  });
});

describe("候选课程派生（勾选 UI 数据源）", () => {
  it("按 Area 派生候选课程（HMW 桶含 HMAW1905）", () => {
    const hmw = coursesForArea("HMW");
    expect(hmw.length).toBeGreaterThan(0);
    expect(hmw.some((c) => c.code === "HMAW1905")).toBe(true);
    // 多 Area 课程出现在每个所属 Area 的列表中
    const multi = hmw.find((c) => c.areas.length > 1);
    if (multi) {
      for (const a of multi.areas) {
        expect(coursesForArea(a).some((c) => c.code === multi.code)).toBe(true);
      }
    }
  });

  it("选修槽候选为全量清单，且与 allCommonCoreCourses 等长", () => {
    expect(coursesForElectiveSlot().length).toBe(allCommonCoreCourses().length);
    expect(allCommonCoreCourses().length).toBeGreaterThan(200);
  });

  it("SUS* 幻影条目已修复为真实课程代码（SUST1030 等）", () => {
    const codes = new Set(allCommonCoreCourses().map((c) => c.code));
    expect(codes.has("SUST1030")).toBe(true);
    expect(codes.has("CIVL1210")).toBe(true);
    expect(codes.has("UCOP3200")).toBe(true);
    expect(codes.has("SUS1030")).toBe(false);
  });

  it("Area 修复回归：官方清单恢复的条目带正确 Area（含 SUS）", () => {
    const byCode = new Map(allCommonCoreCourses().map((c) => [c.code, c.areas]));
    // SUS 补充清单（2025-11-19 官方口径）：基准 Area + SUS
    expect(byCode.get("CHEM1004")).toEqual(["S", "SUS"]);
    expect(byCode.get("ENVR1080")).toEqual(["SA", "SUS"]);
    expect(byCode.get("ISOM1700")).toEqual(["SA", "SUS"]);
    expect(byCode.get("SUST1010")).toEqual(["SUS"]);
    // 2023 完整清单（Spring 2022-23 口径，无 SUS）
    expect(byCode.get("ISOM1380")).toEqual(["SA"]);
    // 仅 4 门待人工复核仍无 Area
    expect(byCode.get("HUMA1660")).toEqual([]);
    expect(byCode.get("ISOM2310")).toEqual([]);
  });

  it("上轮已修复的 11 个条目不回退（含 CIVL1190 证据校正 S,SUS）", () => {
    const byCode = new Map(allCommonCoreCourses().map((c) => [c.code, c.areas]));
    expect(byCode.get("SUST1030")).toEqual(["SUS"]);
    expect(byCode.get("CIVL1100")).toEqual(["T"]);
    expect(byCode.get("CIVL1161")).toEqual(["T"]);
    expect(byCode.get("CIVL1210")).toEqual(["T", "SUS"]);
    expect(byCode.get("FINA1303")).toEqual(["SA"]);
    expect(byCode.get("MECH1905")).toEqual(["S", "T"]);
    expect(byCode.get("ENVR2020")).toEqual(["S", "SUS"]);
    expect(byCode.get("ISOM2030")).toEqual(["SA"]);
    expect(byCode.get("ISDN2110")).toEqual(["A"]);
    expect(byCode.get("UCOP3200")).toEqual(["UxOP"]);
    expect(byCode.get("CIVL1190")).toEqual(["S", "SUS"]); // 官方校正：非 SA
  });
});

describe("引擎计入课程追踪（counted / substitutedCredits）", () => {
  it("普通桶记录实际计入的课程", () => {
    const a = computeCommonCoreAudit({
      courses: [course("HMAW1905"), course("LANG1402", "planned")],
      ...base,
    });
    expect(find(a, "Foundations", "HMW").counted).toEqual([
      { code: "HMAW1905", credits: 3 },
    ]);
    expect(find(a, "Foundations", "E-Comm").counted).toEqual([
      { code: "LANG1402", credits: 3 },
    ]);
    expect(find(a, "Broadening", "A").counted ?? []).toEqual([]);
  });

  it("多 Area 课程只归一处桶（counted 不重复）", () => {
    const a = computeCommonCoreAudit({ courses: [course("ISOM2400")], ...base });
    const sa = find(a, "Broadening", "SA").counted ?? [];
    expect(sa).toEqual([{ code: "ISOM2400", credits: 3 }]);
    // COMP 的 Home T 不设桶
    expect(a.groups[1].buckets.some((b) => b.label === "T")).toBe(false);
  });

  it("选修槽记录替代学分数（E-Comm 溢出替代 CTDL）", () => {
    const a = computeCommonCoreAudit({
      courses: [course("LANG1402"), course("LANG1403"), course("LANG1409")],
      ...base,
    });
    const ctdl = find(a, "Foundations", "CTDL");
    expect(ctdl.counted ?? []).toEqual([]); // 无 CTDL Area 直属课
    expect(ctdl.substitutedCredits).toBe(3);
  });
});

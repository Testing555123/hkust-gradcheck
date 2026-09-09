import { describe, expect, it } from "vitest";
import { computeProgramAudit } from "./audit";
import { collectBranches, filterGroupsByBranch, isGroupActive, totalCreditsWithBranch } from "./branch";
import type { RequirementGroup } from "@/types";

/**
 * 2025-26 MATH：公共核心 20 学分 + 8 个互斥 Track，
 * 各 Track 附加学分取自官方 PDF 的 uncertain 说明（+33 / +40 / +43 / +24 / +33 / +30 / +29 / +34）。
 */
const TRACK_CREDITS: [string, number][] = [
  ["Applied Mathematics Track", 33],
  ["Computer Science Track", 40],
  ["Financial and Actuarial Mathematics Track", 43],
  ["General Mathematics Track", 24],
  ["International Research Enrichment Track", 33],
  ["Pure Mathematics (Advanced) Track", 30],
  ["Pure Mathematics Track", 29],
  ["Statistics Track", 34],
];

function mathGroups(): RequirementGroup[] {
  const groups: RequirementGroup[] = [
    { id: 0, name: "Major Pre-requisite course(s)", required_credits: 4, courses: [], order_index: 0 },
    { id: 1, name: "Required Course(s)", required_credits: 4, courses: [], order_index: 1 },
    { id: 2, name: "Required Course(s)", required_credits: 4, courses: [], order_index: 2 },
    { id: 3, name: "Required Course(s)", required_credits: 4, courses: [], order_index: 3 },
    { id: 4, name: "Required Course(s)", required_credits: 4, courses: [], order_index: 4 },
  ];
  let id = 5;
  for (const [name, credits] of TRACK_CREDITS) {
    // 每个 Track 拆成 Required / Elective 两组，与真实产物一致
    groups.push({
      id: id++,
      name: `${name} Required Course(s)`,
      required_credits: credits - 12,
      courses: [],
      order_index: id,
      branch: name,
      branch_kind: "track",
      branch_optional: true,
      parent_branch: null,
    });
    groups.push({
      id: id++,
      name: `${name} Elective Course(s)`,
      required_credits: 12,
      courses: [],
      order_index: id,
      branch: name,
      branch_kind: "track",
      branch_optional: true,
      parent_branch: null,
    });
  }
  return groups;
}

describe("collectBranches", () => {
  it("MATH 2025-26：核心 20 学分 + 8 个 Track，各 Track 学分与官方一致", () => {
    const s = collectBranches(mathGroups());
    expect(s.hasBranches).toBe(true);
    expect(s.coreCredits).toBe(20);
    expect(s.branches).toHaveLength(8);
    for (const [name, credits] of TRACK_CREDITS) {
      expect(s.byName[name]?.credits).toBe(credits);
      expect(s.byName[name]?.kind).toBe("track");
    }
  });

  it("无分支方案：hasBranches=false，coreCredits 等于全部组之和", () => {
    const s = collectBranches([
      { id: 0, name: "A", required_credits: 10, courses: [], order_index: 0 },
      { id: 1, name: "B", required_credits: 5, courses: [], order_index: 1 },
    ]);
    expect(s.hasBranches).toBe(false);
    expect(s.coreCredits).toBe(15);
  });

  it("二级分支挂到父分支下（CHEM：Core Chemistry Track 内含三个 Option）", () => {
    const groups: RequirementGroup[] = [
      {
        id: 0,
        name: "Core Chemistry Track Required",
        required_credits: 12,
        courses: [],
        order_index: 0,
        branch: "Core Chemistry Track",
        branch_kind: "track",
      },
      {
        id: 1,
        name: "Materials Chemistry Option Required",
        required_credits: 14,
        courses: [],
        order_index: 1,
        branch: "Materials Chemistry Option",
        branch_kind: "option",
        parent_branch: "Core Chemistry Track",
      },
    ];
    const s = collectBranches(groups);
    expect(s.branches).toHaveLength(1);
    expect(s.branches[0].children).toHaveLength(1);
    expect(s.branches[0].children[0].name).toBe("Materials Chemistry Option");
  });
});

describe("filterGroupsByBranch", () => {
  it("未选分支：只剩公共核心（不再出现 174 学分这种把 8 个 Track 全加的数字）", () => {
    const kept = filterGroupsByBranch(mathGroups(), null, null);
    expect(kept).toHaveLength(5);
    expect(kept.reduce((s, g) => s + g.required_credits, 0)).toBe(20);
  });

  it("选中 Applied Mathematics Track：核心 20 + 33", () => {
    const kept = filterGroupsByBranch(mathGroups(), "Applied Mathematics Track", null);
    expect(kept.reduce((s, g) => s + g.required_credits, 0)).toBe(53);
  });

  it("二级分支：父分支已选且子分支已选才计入", () => {
    const child: RequirementGroup = {
      id: 1,
      name: "Materials Chemistry Option Required",
      required_credits: 14,
      courses: [],
      order_index: 1,
      branch: "Materials Chemistry Option",
      branch_kind: "option",
      parent_branch: "Core Chemistry Track",
    };
    expect(isGroupActive(child, "Core Chemistry Track", "Materials Chemistry Option")).toBe(true);
    expect(isGroupActive(child, "Core Chemistry Track", null)).toBe(false);
    expect(isGroupActive(child, "Core Chemistry Track", "Pure Chemistry Option")).toBe(false);
    expect(isGroupActive(child, "Biomolecular Chemistry Track", "Materials Chemistry Option")).toBe(
      false
    );
  });
});

describe("computeProgramAudit 分支口径", () => {
  it("各 Track 分母 = 核心 20 + 该 Track 学分（对照官方 uncertain 数值）", () => {
    const groups = mathGroups();
    for (const [name, credits] of TRACK_CREDITS) {
      const a = computeProgramAudit(groups, {}, { selectedBranch: name });
      expect(a.totalRequired).toBe(20 + credits);
    }
  });

  it("不传 opts：保持「全部组累加」的旧行为", () => {
    const groups = mathGroups();
    const legacy = computeProgramAudit(groups, {});
    const all = TRACK_CREDITS.reduce((s, [, c]) => s + c, 20);
    expect(legacy.totalRequired).toBe(all);
  });
});

describe("totalCreditsWithBranch", () => {
  it("核心 + 一级分支 + 二级分支", () => {
    const s = collectBranches([
      {
        id: 0,
        name: "core",
        required_credits: 38,
        courses: [],
        order_index: 0,
      },
      {
        id: 1,
        name: "Core Chemistry Track",
        required_credits: 12,
        courses: [],
        order_index: 1,
        branch: "Core Chemistry Track",
        branch_kind: "track",
      },
      {
        id: 2,
        name: "Materials Chemistry Option",
        required_credits: 14,
        courses: [],
        order_index: 2,
        branch: "Materials Chemistry Option",
        branch_kind: "option",
        parent_branch: "Core Chemistry Track",
      },
    ]);
    expect(totalCreditsWithBranch(s, null, null)).toBe(38);
    expect(totalCreditsWithBranch(s, "Core Chemistry Track", null)).toBe(50);
    expect(totalCreditsWithBranch(s, "Core Chemistry Track", "Materials Chemistry Option")).toBe(64);
  });
});

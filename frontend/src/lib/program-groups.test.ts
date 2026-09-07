import { describe, expect, it } from "vitest";

import {
  filterPrograms,
  groupPrograms,
  isMajor,
  kindOf,
  matchProgramsByTitle,
} from "@/lib/program-groups";
import type { ProgramInfo } from "@/types";

const p = (code: string, title = `Title ${code}`): ProgramInfo => ({
  year: "2026-27",
  code,
  title,
  total_required_credits: 0,
});

describe("kindOf", () => {
  it("按前缀区分四类方案", () => {
    expect(kindOf("COMP")).toBe("major");
    expect(kindOf("EXTM-AI")).toBe("extm");
    expect(kindOf("MINOR-MATH")).toBe("minor");
    expect(kindOf("SREQ-SSCI")).toBe("school");
  });

  it("isMajor 只认无前缀的主修", () => {
    expect(isMajor(p("COMP"))).toBe(true);
    expect(isMajor(p("MINOR-MATH"))).toBe(false);
    expect(isMajor(p("SREQ-SBM"))).toBe(false);
  });
});

describe("groupPrograms", () => {
  it("按 主修→EXTM→辅修→学院要求 排序并去掉空分组", () => {
    const groups = groupPrograms([p("MINOR-MATH"), p("COMP"), p("SREQ-SSCI")]);
    expect(groups.map((g) => g.kind)).toEqual(["major", "minor", "school"]);
  });

  it("kinds 限定后只保留指定类别", () => {
    const groups = groupPrograms([p("COMP"), p("MINOR-MATH"), p("EXTM-AI")], ["major"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.code)).toEqual(["COMP"]);
  });
});

describe("filterPrograms", () => {
  const list = [p("COMP", "BSc in Computer Science"), p("MINOR-MATH", "Minor in Mathematics")];

  it("空关键字原样返回", () => {
    expect(filterPrograms(list, "  ")).toBe(list);
  });

  it("可按代码或名称匹配", () => {
    expect(filterPrograms(list, "comp").map((x) => x.code)).toEqual(["COMP"]);
    expect(filterPrograms(list, "mathematics").map((x) => x.code)).toEqual(["MINOR-MATH"]);
  });

  it("可按类别中文名匹配", () => {
    expect(filterPrograms(list, "辅修").map((x) => x.code)).toEqual(["MINOR-MATH"]);
  });
});

describe("matchProgramsByTitle", () => {
  const candidates = [
    p("MATH", "BSc in Mathematics"),
    p("MAEC", "BSc in Mathematics and Economics"),
    p("COMP", "BEng in Computer Science"),
    p("MINOR-MATH", "Minor Program in Mathematics"),
    p("EXTM-AI", "Extended Major Program in Artificial Intelligence"),
  ];

  it("完整文本命中（含）", () => {
    expect(matchProgramsByTitle("Artificial Intelligence", candidates)).toEqual(["EXTM-AI"]);
  });

  it("括号前主干词命中（多匹配全返回）", () => {
    expect(matchProgramsByTitle("Mathematics (Statistics Track)", candidates)).toEqual([
      "MATH",
      "MAEC",
      "MINOR-MATH",
    ]);
  });

  it("未命中返回空数组", () => {
    expect(matchProgramsByTitle("Quantum Computing", candidates)).toEqual([]);
  });

  it("空/未定义输入返回空数组", () => {
    expect(matchProgramsByTitle(undefined, candidates)).toEqual([]);
    expect(matchProgramsByTitle("   ", candidates)).toEqual([]);
  });
});

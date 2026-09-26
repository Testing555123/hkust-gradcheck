import { describe, expect, it } from "vitest";
import {
  resolveAttachedPrograms,
  schoolReqCode,
  selectableAttached,
} from "./attached";
import type { ProgramInfo } from "../types";

function program(year: string, code: string, title?: string): ProgramInfo {
  return { year, code, title: title ?? code, total_required_credits: 0 };
}

const PROGRAMS: ProgramInfo[] = [
  program("2026-27", "COMP", "BEng in Computer Science"),
  program("2026-27", "SREQ-SSCI", "School Requirements: School of Science"),
  program("2026-27", "SREQ-SBM", "School Requirements: School of Business and Management"),
  program("2026-27", "MINOR-MATH", "Minor Program in Mathematics"),
  program("2026-27", "EXTM-AI", "Extended Major in Artificial Intelligence"),
  // 2025-26：SREQ skipped（无产物），MINOR 可用
  program("2025-26", "COMP", "BEng in Computer Science"),
  program("2025-26", "MINOR-MATH", "Minor Program in Mathematics"),
];

describe("schoolReqCode", () => {
  it("SSCI/SBM 映射到对应 SREQ", () => {
    expect(schoolReqCode("SSCI")).toBe("SREQ-SSCI");
    expect(schoolReqCode("SBM")).toBe("SREQ-SBM");
  });
  it("无数据的学院与空值返回 null", () => {
    expect(schoolReqCode("SENG")).toBeNull();
    expect(schoolReqCode("SHSS")).toBeNull();
    expect(schoolReqCode(null)).toBeNull();
  });
});

describe("resolveAttachedPrograms", () => {
  it("理学院主修自动附加 SREQ-SSCI（available）", () => {
    const r = resolveAttachedPrograms("2026-27", "MATH", [], PROGRAMS);
    const school = r.find((a) => a.kind === "school");
    expect(school).toBeDefined();
    expect(school!.code).toBe("SREQ-SSCI");
    expect(school!.available).toBe(true);
  });

  it("商学院主修自动附加 SREQ-SBM", () => {
    const r = resolveAttachedPrograms("2026-27", "ECON", [], PROGRAMS);
    expect(r.find((a) => a.kind === "school")!.code).toBe("SREQ-SBM");
  });

  it("工学院主修无学院要求（SENG 无数据）", () => {
    const r = resolveAttachedPrograms("2026-27", "COMP", [], PROGRAMS);
    expect(r.find((a) => a.kind === "school")).toBeUndefined();
    expect(r).toHaveLength(0);
  });

  it("school 参数优先于 schoolOf 反查", () => {
    const r = resolveAttachedPrograms("2026-27", "MATH", [], PROGRAMS, "SBM");
    expect(r.find((a) => a.kind === "school")!.code).toBe("SREQ-SBM");
  });

  it("2025-26 的 SREQ 无产物 → available=false（降级）", () => {
    const r = resolveAttachedPrograms("2025-26", "MATH", [], PROGRAMS);
    const school = r.find((a) => a.kind === "school");
    expect(school!.available).toBe(false);
  });

  it("多辅修解析：MINOR 与 EXTM 分别标注 kind，可用性正确", () => {
    const r = resolveAttachedPrograms("2026-27", "COMP", ["MINOR-MATH", "EXTM-AI"], PROGRAMS);
    const minor = r.find((a) => a.code === "MINOR-MATH")!;
    const extm = r.find((a) => a.code === "EXTM-AI")!;
    expect(minor.kind).toBe("minor");
    expect(minor.available).toBe(true);
    expect(minor.label).toContain("Minor Program in Mathematics");
    expect(extm.kind).toBe("extm");
    expect(extm.available).toBe(true);
  });

  it("引用不存在的辅修 code → available=false（降级）", () => {
    const r = resolveAttachedPrograms("2026-27", "COMP", ["MINOR-NOPE"], PROGRAMS);
    expect(r[0].available).toBe(false);
  });
});

describe("selectableAttached", () => {
  it("仅列出当前学年的 MINOR/EXTM，排除主修与 SREQ，按名称排序", () => {
    const list = selectableAttached("2026-27", PROGRAMS);
    expect(list.map((x) => x.code)).toEqual(["EXTM-AI", "MINOR-MATH"]);
    expect(list.every((x) => x.kind !== "school")).toBe(true);
  });
  it("2025-26 只有 MINOR 可选", () => {
    const list = selectableAttached("2025-26", PROGRAMS);
    expect(list.map((x) => x.code)).toEqual(["MINOR-MATH"]);
  });
});

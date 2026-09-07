import { describe, expect, it } from "vitest";

import { parseTranscript, TranscriptParseError } from "./transcript";

/**
 * Golden fixture：真实样本（SSR_TSRPT_U.pdf）脱敏版。
 * 姓名/学号替换为假数据，排版与行结构保持一致；含转专业、重复课程、在读 `**` 等关键形态。
 */
const FIXTURE = `Name:
CHAN, Tai Man 陳大文
Student ID:
20000000
Year of Study:
2nd Year
Reg Status:
Active in Program
Print Date:
8 March 2026
16:23:36
Unofficial Transcript of Academic Record (as of 07 March 2026)
Page 1 of 2
Advisor(s):
WONG, Kei
Academic Program
Admit Date:
Program:
2 September 2024
Bachelor Degree in School of Science (with Extended Major in Artificial
Intelligence)
Program Change:
2025-26 Fall
Program:
Bachelor of Science
Major:
Mathematics (Statistics Track) (with Extended Major in Artificial
Intelligence)
Academic Records
2024-25 Fall (Full-Time)
Course Code
Course Title
Credit
Attempted
Credit
Earned
Grade
CHEM1008
Introductory Chemistry
3.0
3.0
C+
HMAW1905A
Behavioral Foundations of University
Education: Habits, Mindsets, and
Wellness
3.0
-
PP
MATH1013
Calculus IB
3.0
3.0
B
TGA: 2.520
CGA: 2.520
Cumulative Credits Earned:   15.0
2024-25 Winter (Full-Time)
Course Code
Course Title
Credit
Attempted
Credit
Earned
Grade
LEGL1000
Legal Education (Basic Law, National
Security Law and Safeguarding
National Security Ordinance)
0.0
-
P
TGA: **
CGA: 2.520
Cumulative Credits Earned:   15.0
2024-25 Spring (Full-Time)
Course Code
Course Title
Credit
Attempted
Credit
Earned
Grade
HMAW1905A
Behavioral Foundations of University
Education: Habits, Mindsets, and
Wellness
3.0
3.0
P
COMP1021
Introduction to Computer Science
3.0
3.0
C
MATH1014
Calculus II
3.0
3.0
C+
TGA: 2.669
CGA: 2.597
Cumulative Credits Earned:   34.0
2025-26 Spring (Full-Time)
Course Code
Course Title
Credit
Attempted
Credit
Earned
Grade
COMP2011
Programming with C++
4.0
-
**
MATH2033
Mathematical Analysis
4.0
-
**
- End of Transcript -`;

const result = parseTranscript(FIXTURE);

describe("parseTranscript / 头部字段", () => {
  it("Program Change 学年优先于 Admit Date", () => {
    expect(result.programChangeYear).toBe("2025-26");
    expect(result.admitYear).toBe("2024-25");
    expect(result.effectiveYear).toBe("2025-26");
  });

  it("Major 多行合并并剥离内嵌 Extended Major", () => {
    expect(result.major).toBe("Mathematics (Statistics Track)");
    expect(result.extendedMajor).toBe("Artificial Intelligence");
    expect(result.minor).toBeUndefined();
  });
});

describe("parseTranscript / 课程行", () => {
  it("学期按出现顺序去重收集", () => {
    expect(result.terms).toEqual([
      "2024-25 Fall",
      "2024-25 Winter",
      "2024-25 Spring",
      "2025-26 Spring",
    ]);
  });

  it("课名多行合并，学分与成绩正确", () => {
    const chem = result.courses.find((c) => c.code === "CHEM1008");
    expect(chem).toMatchObject({ title: "Introductory Chemistry", credits: 3, grade: "C+", status: "taken" });
    const legl = result.courses.find((c) => c.code === "LEGL1000");
    expect(legl).toMatchObject({ credits: 0, grade: "P", status: "taken" });
    const hmaw = result.courses.find((c) => c.code === "HMAW1905A");
    expect(hmaw?.title).toBe("Behavioral Foundations of University Education: Habits, Mindsets, and Wellness");
  });

  it("`**` 在读课程映射为 planned", () => {
    const comp2011 = result.courses.find((c) => c.code === "COMP2011");
    expect(comp2011).toMatchObject({ status: "planned", term: "2025-26 Spring", grade: "**" });
    expect(result.courses.filter((c) => c.status === "planned").map((c) => c.code)).toEqual([
      "COMP2011",
      "MATH2033",
    ]);
  });

  it("同课号后学期覆盖前学期并给出诊断", () => {
    const hmaw = result.courses.filter((c) => c.code === "HMAW1905A");
    expect(hmaw).toHaveLength(1);
    expect(hmaw[0]).toMatchObject({ term: "2024-25 Spring", grade: "P" });
    expect(result.repeated).toContain("HMAW1905A");
    expect(result.warnings.some((w) => w.includes("HMAW1905A"))).toBe(true);
  });

  it("课程按学期顺序排序", () => {
    const terms = result.courses.map((c) => c.term);
    expect(terms).toEqual([...terms].sort((a, b) => result.terms.indexOf(a) - result.terms.indexOf(b)));
  });
});

/**
 * 含 Minor: 行与内嵌 EXTM 的样本，验证主修/副修/EXTM 三项正确分离。
 */
const MINOR_FIXTURE = `Name:
CHAN, Tai Man
Student ID:
20000000
Admit Date:
2 September 2024
Major:
Bachelor of Engineering in Computer Science (with Extended Major in Artificial
Intelligence)
Minor:
Bachelor of Science in Mathematics
Academic Records
2024-25 Fall (Full-Time)
COMP1021 Introduction to Computer Science 3.0 3.0 A
- End of Transcript -`;

const minorResult = parseTranscript(MINOR_FIXTURE);

describe("parseTranscript / 含 Minor 与内嵌 EXTM", () => {
  it("主修剥离 EXTM、副修独立抽取", () => {
    expect(minorResult.major).toBe("Bachelor of Engineering in Computer Science");
    expect(minorResult.extendedMajor).toBe("Artificial Intelligence");
    expect(minorResult.minor).toBe("Bachelor of Science in Mathematics");
  });
});

describe("parseTranscript / 失败校验", () => {
  it("非成绩单文本抛出可读错误", () => {
    expect(() => parseTranscript("Hello world\nThis is not a transcript")).toThrow(
      TranscriptParseError
    );
  });

  it("空文本抛出错误", () => {
    expect(() => parseTranscript("")).toThrow(TranscriptParseError);
  });
});

/**
 * pdfjs 的线性化风格：标签与值同行、课程行合并为一行。
 * 与上面 pymupdf 风格（token/行）形成双格式回归覆盖。
 */
const PDFJS_FIXTURE = `Name: CHAN, Tai Man 陳大文
Student ID: 20000000
Year of Study: 2nd Year Reg Status: Active in Program
Print Date: 8 March 2026 16:23:36
Unofficial Transcript of Academic Record (as of 07 March 2026)
Page 1 of 2
Advisor(s): WONG, Kei
Academic Program Admit Date: Program: 2 September 2024 Bachelor Degree in School of Science (with Extended Major in Artificial Intelligence) Program Change: 2025-26 Fall Program: Bachelor of Science Major: Mathematics (Statistics Track) (with Extended Major in Artificial Intelligence)
Academic Records
2024-25 Fall (Full-Time)
Course Code Course Title Credit Attempted Credit Earned Grade
CHEM1008 Introductory Chemistry 3.0 3.0 C+
HMAW1905A Behavioral Foundations of University Education: Habits, Mindsets, and Wellness 3.0 - PP
MATH1013 Calculus IB 3.0 3.0 B
TGA: 2.520 CGA: 2.520 Cumulative Credits Earned: 15.0
2025-26 Spring (Full-Time)
Course Code Course Title Credit Attempted Credit Earned Grade
COMP2011 Programming with C++ 4.0 - **
MATH2033 Mathematical Analysis 4.0 - **
- End of Transcript -`;

const pdfjsResult = parseTranscript(PDFJS_FIXTURE);

describe("parseTranscript / pdfjs 行式文本", () => {
  it("头部字段与学期解析一致（主修剥离 EXTM）", () => {
    expect(pdfjsResult.effectiveYear).toBe("2025-26");
    expect(pdfjsResult.major).toBe("Mathematics (Statistics Track)");
    expect(pdfjsResult.extendedMajor).toBe("Artificial Intelligence");
    expect(pdfjsResult.terms).toEqual(["2024-25 Fall", "2025-26 Spring"]);
  });

  it("课程行整行匹配，在读为 planned", () => {
    expect(pdfjsResult.courses.map((c) => c.code)).toEqual([
      "CHEM1008",
      "HMAW1905A",
      "MATH1013",
      "COMP2011",
      "MATH2033",
    ]);
    const comp2011 = pdfjsResult.courses.find((c) => c.code === "COMP2011");
    expect(comp2011).toMatchObject({ status: "planned", credits: 4 });
    const hmaw = pdfjsResult.courses.find((c) => c.code === "HMAW1905A");
    expect(hmaw?.title).toBe(
      "Behavioral Foundations of University Education: Habits, Mindsets, and Wellness"
    );
    expect(hmaw?.status).toBe("taken");
  });
});

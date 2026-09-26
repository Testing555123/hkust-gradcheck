/**
 * HKUST unofficial transcript 解析：纯函数 + 规则表集中（可维护性纪律来自
 * MinerU 的 pipeline 配置思路与 acatrack 的 golden-fixture 做法）。
 *
 * 输入：pdfjs-dist 抽出的线性文本（逐行）。
 * 格式规则来自真实样本逆向（2026-09）：
 * - 学期标题：`2024-25 Fall (Full-Time)`
 * - 课程行（线性化）：CODE → 课名(1~3 行) → Credit Attempted → Credit Earned(可为 `-`) → Grade
 * - 成绩 `**` / 缺失 = 在读 → planned；其余（含 P/PP/AU）→ taken
 * - 同课号多学期：后学期覆盖前学期，计入 repeated
 * - 学年推导：Program Change 学年 > Admit Date 年份（转专业以变更后学年查要求树）
 */

export type TranscriptCourseStatus = "taken" | "planned";

export interface TranscriptCourse {
  code: string;
  title: string;
  /** Credit Attempted */
  credits: number;
  /** 如 "2024-25 Fall" */
  term: string;
  /** 原始成绩 token，如 "B-"、"PP"、"**"；缺失为 "" */
  grade: string;
  status: TranscriptCourseStatus;
}

export interface TranscriptInfo {
  /** Major 原文（已剥离内嵌 Extended Major / 后续 Minor 段） */
  major?: string;
  /** 从头部 Minor: 标签抽取的原始副修文本 */
  minor?: string;
  /** 从主修行 (with Extended Major in X) 抽取的原始 EXTM 文本 */
  extendedMajor?: string;
  /** Program Change 学年（如 "2025-26"） */
  programChangeYear?: string;
  /** Admit Date 推导学年（如 "2024-25"） */
  admitYear?: string;
  /** 用于匹配要求树的学年 = Program Change ?? Admit Date */
  effectiveYear?: string;
  /** 出现顺序的学期列表 */
  terms: string[];
  /** 去重后的课程（按学期顺序，同课号取较新学期） */
  courses: TranscriptCourse[];
  /** 出现多次的课号 */
  repeated: string[];
  /** 供预览页展示的诊断信息 */
  warnings: string[];
}

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptParseError";
  }
}

/* ---------- 规则表（格式漂移时只改这里） ---------- */

/** 学期标题。兼容行式/流式文本（\s+ 同时吃空格与换行） */
const TERM_RE = /(\d{4}-\d{2})\s+(Fall|Winter|Spring|Summer)\s*\((?:Full|Part)-Time\)/g;
/**
 * 课程行（全局匹配，对换行不敏感）：
 * CODE → 课名(懒) → Credit Attempted → Credit Earned(`-` 允许) → Grade
 * 课名用「懒惰 + 回溯」对齐到最近的学分锚点；对 pymupdf（token/行）与
 * pdfjs（行/行）两种线性化输出均成立。
 */
const ROW_RE =
  /([A-Z]{3,4}\d{4}[A-Z]?)\s+((?:(?!TGA:|CGA:)[\s\S])*?)\s+(\d+(?:\.\d+)?)\s+(-|\d+(?:\.\d+)?)\s+((?:\*\*|[A-D][+-]?|F|P|PP|AU|W|IP))(?![\w-])/g;
/** 学期表格表头（整段出现，直接剔除） */
const TABLE_HEADER_RE =
  /Course\s+Code\s+Course\s+Title\s+Credit\s+Attempted\s+Credit\s+Earned\s+Grade/g;
const NOISE_RE =
  /\b(TGA:\s*[\d.*]+|CGA:\s*[\d.*]+|Cumulative\s+Credits\s+Earned:\s*[\d.]+|- End of Transcript -|Page \d+ of \d+)/g;
const MIN_TEXT_LENGTH = 50;

/* ---------- PDF 抽文本（浏览器端，动态加载 pdfjs 保持主包干净） ---------- */

export async function extractTranscriptText(file: File): Promise<string> {
  let text = "";
  try {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        const it = item as { str?: string; hasEOL?: boolean };
        if (typeof it.str === "string") text += it.str;
        if (it.hasEOL) text += "\n";
      }
      text += "\n";
    }
  } catch (error) {
    console.error("transcript: PDF 文本抽取失败", error);
    if (error instanceof TranscriptParseError) throw error;
    throw new TranscriptParseError("无法读取该 PDF，请确认文件未损坏且为 unofficial transcript。");
  }
  if (text.trim().length < MIN_TEXT_LENGTH) {
    throw new TranscriptParseError(
      "该 PDF 没有文本层（可能是扫描件）。请从 SIS 重新下载 unofficial transcript，或改用手动勾选。"
    );
  }
  return text;
}

/* ---------- 解析 ---------- */

export function parseTranscript(text: string): TranscriptInfo {
  if (text.trim().length < MIN_TEXT_LENGTH) {
    throw new TranscriptParseError(
      "无法识别为 HKUST 成绩单：文本内容过少（可能是扫描件，无文本层）。"
    );
  }

  // 头部 = 第一个 "Academic Records" 之前；其后为课程记录区
  const headerEnd = text.search(/\bAcademic Records\b/);
  const headerText = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
  const body = headerEnd >= 0 ? text.slice(headerEnd) : text;

  const programChangeYear = matchProgramChangeYear(headerText);
  const admitYear = matchAdmitYear(headerText);
  // 主修：遇 Minor: 即停止，避免把副修文本吞入；再剥离内嵌的 Extended Major 段
  const { major, extendedMajor } = extractExtendedMajor(
    captureAfterLabel(headerText, "Major", ["Minor"])
  );
  const minor = captureAfterLabel(headerText, "Minor");

  // 1) 学期边界切分（保持出现顺序）
  const termMarks = Array.from(body.matchAll(TERM_RE));
  if (termMarks.length === 0) {
    throw new TranscriptParseError(
      "无法识别为 HKUST 成绩单：未找到学期行。请确认上传的是 SIS 导出的 unofficial transcript（文字版 PDF）。"
    );
  }
  const terms: string[] = [];
  const segments: { term: string; text: string }[] = [];
  for (let i = 0; i < termMarks.length; i++) {
    const m = termMarks[i];
    const term = `${m[1]} ${m[2]}`;
    if (!terms.includes(term)) terms.push(term);
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < termMarks.length ? termMarks[i + 1].index ?? body.length : body.length;
    segments.push({ term, text: body.slice(start, end) });
  }

  // 2) 每个学期段内全局匹配课程行（去噪后），后学期覆盖前学期
  const courseMap = new Map<string, TranscriptCourse>();
  const repeated = new Set<string>();
  const warnings: string[] = [];
  for (const seg of segments) {
    const cleaned = seg.text.replace(TABLE_HEADER_RE, " ").replace(NOISE_RE, " ");
    for (const m of cleaned.matchAll(ROW_RE)) {
      const course: TranscriptCourse = {
        code: m[1],
        title: m[2].replace(/\s+/g, " ").trim(),
        credits: Number(m[3]),
        term: seg.term,
        grade: m[5],
        // `**` = 在读；其余（含 P/PP/AU）= 已修
        status: m[5] === "**" ? "planned" : "taken",
      };
      if (courseMap.has(course.code)) {
        repeated.add(course.code);
        warnings.push(`重复课程 ${course.code}：以较新学期（${course.term}）为准`);
      }
      courseMap.set(course.code, course);
    }
  }

  const courses = Array.from(courseMap.values()).sort(
    (a, b) => terms.indexOf(a.term) - terms.indexOf(b.term) || a.code.localeCompare(b.code)
  );
  if (courses.length === 0) {
    throw new TranscriptParseError(
      "已找到学期，但未能解析出课程行。该成绩单版式可能已变化，请反馈样本或改用手动勾选。"
    );
  }
  if (repeated.size > 0) {
    warnings.unshift(`检测到 ${repeated.size} 门重复修读课程，已按较新学期取值`);
  }

  return {
    major: major || undefined,
    minor: minor || undefined,
    extendedMajor,
    programChangeYear,
    admitYear,
    effectiveYear: programChangeYear ?? admitYear,
    terms,
    courses,
    repeated: Array.from(repeated),
    warnings,
  };
}

/* ---------- 头部字段抽取 ---------- */

function matchProgramChangeYear(header: string): string | undefined {
  const m = header.match(/Program Change:\s*\n?\s*(\d{4}-\d{2})/);
  return m ? m[1] : undefined;
}

function matchAdmitYear(header: string): string | undefined {
  // Admit Date 后 120 字符内的第一个 4 位年份（"2 September 2024" → 2024）
  const m = header.match(/Admit Date:[\s\S]{0,120}?\b(\d{4})\b/);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (year < 1990 || year > 2100) return undefined;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

/**
 * 取 `Label:` 之后的剩余内容合并为一段。
 * stopLabels 给出额外终止边界（如 Major 在遇见 `Minor:` 时停止，避免把副修文本吞进主修）；
 * 默认终止于 `Academic Records`。
 */
function captureAfterLabel(header: string, label: string, stopLabels: string[] = []): string {
  const stops = [...stopLabels, "Academic Records"];
  const stopAlt = stops.join("|");
  const m = header.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\b(?:${stopAlt})\\b|$)`, "i"));
  if (!m) return "";
  return m[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" ");
}

/** 抽取主修行内嵌的 Extended Major，如 "Mathematics (with Extended Major in Artificial Intelligence)" → "Artificial Intelligence" */
function extractExtendedMajor(major: string): { major: string; extendedMajor?: string } {
  const m = major.match(/with\s+Extended\s+Major\s+in\s+([^()]+)/i);
  if (!m) return { major };
  const extendedMajor = m[1].trim();
  const cleaned = major.replace(/\(?\s*with\s+Extended\s+Major\s+in\s+[^()]+\)?/i, "").trim();
  return { major: cleaned, extendedMajor: extendedMajor || undefined };
}

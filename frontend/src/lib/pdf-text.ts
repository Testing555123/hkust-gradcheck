/**
 * 成绩单 PDF → 线性文本（浏览器端 IO 适配器）。
 *
 * 从 packages/domain/lib/transcript.ts 拆出来，理由不是整洁而是硬约束：
 * 这里用了 `File` API 和 **Vite 专有后缀** `?url`，留在领域层会让任何
 * Node 侧 `import "@newone/domain"` 的后端直接炸。§4.7 的解析规则本体
 * 仍在领域层，本文件只负责"把 PDF 变成文本"，产出交给 parseTranscript。
 */
import { MIN_TEXT_LENGTH, TranscriptParseError } from "@/lib/transcript";

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


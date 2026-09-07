import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface UncertainNotesProps {
  /** LLM 抽取时记录的存疑说明（pipeline/output 的 uncertain 字段） */
  notes: string[] | undefined;
}

/**
 * 「数据存疑 N 条」折叠入口：默认只占一枚徽标，点开才展开全部说明。
 *
 * 存疑说明是抽取过程的副产品，对多数用户无意义，但不能丢 ——
 * 它是学生回查官方 PDF 时最有价值的信息，所以折叠而非隐藏。
 */
export function UncertainNotes({ notes }: UncertainNotesProps) {
  const [open, setOpen] = useState(false);
  if (!notes || notes.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="uncertain-badge"
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5",
          "text-[11px] text-warning transition-colors hover:bg-warning/20"
        )}
        title="查看数据存疑说明"
      >
        <AlertTriangle className="h-3 w-3" />
        数据存疑 {notes.length} 条
        <ChevronRight className="h-3 w-3" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              数据存疑说明（{notes.length} 条）
            </DialogTitle>
            <DialogDescription>
              以下条目由自动抽取流程标记，表示原始 PDF 的表述存在歧义或缺失；
              涉及学分与选课判断时请以教务处官方认定为准。
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {notes.map((note, i) => (
              <li
                key={i}
                className="flex gap-2 rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs leading-relaxed"
              >
                <span className="shrink-0 font-mono text-muted-foreground">{i + 1}.</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

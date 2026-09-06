import { RequirementTree } from "@/components/business/RequirementTree";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import type { ProgramTreeData } from "@/types";

/** 毕业要求明细页：完整要求树 + PDF 页码出处 */
export function RequirementsPage({ tree }: { tree: ProgramTreeData }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <FileText className="h-4 w-4" />
        <span>数据来源：官方培养方案 PDF</span>
        {tree.program.source_pdf && (
          <Badge variant="outline" className="font-mono text-[11px] max-w-[320px] truncate">
            {tree.program.source_pdf.split(/[\\/]/).pop()}
          </Badge>
        )}
        <span>· 每项要求均标注原文页码，可回溯核对</span>
      </div>
      <RequirementTree tree={tree} />
    </div>
  );
}

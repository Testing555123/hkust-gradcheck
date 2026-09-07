import { RequirementTree } from "@/components/business/RequirementTree";
import { CommonCoreSection } from "@/components/business/CommonCoreSection";
import { Badge } from "@/components/ui/badge";
import { BookOpen, FileText, School } from "lucide-react";
import type { AttachedEntryView } from "@/pages/OverviewPage";
import type { ProgramTreeData } from "@/types";

/** 毕业要求明细页：主修要求树 + 通识核心区块 + 附加要求（辅修/学院）区块 */
export function RequirementsPage({
  tree,
  attachedEntries = [],
}: {
  tree: ProgramTreeData;
  attachedEntries?: AttachedEntryView[];
}) {
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
      <CommonCoreSection tree={tree} />

      {/* 附加要求：辅修 / 学院要求 / EXTM */}
      {attachedEntries.map(({ attached, tree: at, isLoading, isError }) => (
        <div key={attached.code} className="space-y-3">
          <div className="flex items-center gap-2 border-t border-dashed pt-4">
            {attached.kind === "school" ? (
              <School className="h-4 w-4 text-primary" />
            ) : (
              <BookOpen className="h-4 w-4 text-success" />
            )}
            <span className="text-sm font-semibold">{attached.label}</span>
            <Badge variant="outline" className="font-normal text-[10px]">
              {attached.year}
            </Badge>
          </div>
          {!attached.available && (
            <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              {attached.year} 学年暂无此要求数据（官方未发布或爬取状态为 skipped）
            </p>
          )}
          {attached.available && isLoading && (
            <div className="h-24 animate-pulse-soft rounded-lg bg-muted" />
          )}
          {attached.available && isError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              附加要求数据加载失败，请稍后重试
            </p>
          )}
          {attached.available && at && <RequirementTree tree={at} />}
        </div>
      ))}
    </div>
  );
}

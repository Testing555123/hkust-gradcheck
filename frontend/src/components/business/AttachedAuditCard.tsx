import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { computeProgramAudit } from "@/lib/audit";
import { useSelection } from "@/stores/selection";
import { BookOpen, School, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttachedProgram } from "@/lib/attached";
import type { ProgramTreeData } from "@/types";

interface AttachedAuditCardProps {
  attached: AttachedProgram;
  tree: ProgramTreeData;
  /** 仅辅修可移除（学院要求自动跟随主修） */
  onRemove?: () => void;
}

/** 附加要求进度卡：辅修 / 学院要求 / Extended Major，勾选与主修跨方案共享 */
export function AttachedAuditCard({ attached, tree, onRemove }: AttachedAuditCardProps) {
  const status = useSelection((s) => s.status);
  const audit = computeProgramAudit(tree.groups, status);

  const isSchool = attached.kind === "school";
  const Icon = isSchool ? School : BookOpen;
  const tone = isSchool ? "text-primary bg-primary/10" : "text-success bg-success/10";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 space-y-3 transition-shadow hover:shadow-sm",
        isSchool ? "border-primary/25" : "border-success/25"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              tone
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">
              <Badge variant="outline" className="mr-1.5 font-normal text-[10px] align-[1px]">
                {isSchool ? "学院要求" : attached.kind === "extm" ? "EXTM" : "辅修"}
              </Badge>
              {tree.program.title}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tree.program.year} 学年 · 要求 {audit.totalRequired} 学分 ·{" "}
              {audit.groups.reduce((s, g) => s + g.group.courses.length, 0)} 门课
            </p>
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`移除 ${attached.label}`}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">已修</span>
          <span className="font-medium tabular-nums">
            {audit.totalTaken} / {audit.totalRequired}
          </span>
        </div>
        <Progress value={audit.percentTaken} className="h-1.5" />
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">含计划</span>
          <span className="font-medium tabular-nums">
            {audit.totalPlanned} / {audit.totalRequired}
          </span>
        </div>
        <Progress
          value={audit.percentPlanned}
          className="h-1.5"
          indicatorClassName={isSchool ? "bg-primary/45" : "bg-success/45"}
        />
      </div>

      {audit.missingCount > 0 && (
        <p className="border-t border-dashed pt-2 text-xs text-warning">
          尚有 {audit.missingCount} 门缺口课程未安排
        </p>
      )}
    </div>
  );
}

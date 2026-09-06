import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { GroupAudit } from "@/types";

export function ProgressCard({ audit }: { audit: GroupAudit }) {
  const { group } = audit;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{group.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              要求 {group.required_credits} 学分 · {group.courses.length} 门课
            </p>
          </div>
          {audit.isDone ? (
            <Badge variant="success" className="gap-1 shrink-0">
              <CheckCircle2 className="h-3 w-3" /> 达标
            </Badge>
          ) : audit.remaining > 0 ? (
            <Badge variant="warning" className="shrink-0">
              尚缺 {audit.remaining}
            </Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0">
              计划可覆盖
            </Badge>
          )}
        </div>

        {/* 已修进度（深色实条） */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">已修</span>
            <span className="font-medium tabular-nums">
              {audit.takenCredits} / {audit.requiredCredits}
            </span>
          </div>
          <Progress value={audit.percentTaken} indicatorClassName="animate-progress-grow" />
        </div>

        {/* 含计划的进度（叠加浅色差值） */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">含计划</span>
            <span className="font-medium tabular-nums">
              {audit.plannedCredits} / {audit.requiredCredits}
            </span>
          </div>
          <Progress
            value={audit.percentPlanned}
            indicatorClassName="bg-primary/45 animate-progress-grow"
          />
        </div>

        {audit.missingCourses.length > 0 && (
          <div className="flex items-start gap-1.5 text-xs text-warning pt-1 border-t border-dashed">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="leading-snug">
              缺口 {audit.missingCourses.length} 门：
              <span className="font-mono">
                {audit.missingCourses.slice(0, 3).map((c) => c.code).join("、")}
              </span>
              {audit.missingCourses.length > 3 && " 等"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

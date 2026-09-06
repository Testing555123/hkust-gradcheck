import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ProgressCard } from "@/components/business/ProgressCard";
import { StatCard } from "@/components/business/StatCard";
import { computeProgramAudit } from "@/lib/audit";
import { useSelection } from "@/stores/selection";
import { GraduationCap, ListChecks, Trash2, BookOpen, CheckCircle2, CalendarClock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ProgramTreeData } from "@/types";

/** 方案总览：缺口/进度双读数焦点 + 横向进度条 + 统计卡 + 各要求组进度 */
export function OverviewPage({ tree }: { tree: ProgramTreeData }) {
  const status = useSelection((s) => s.status);
  const clearAll = useSelection((s) => s.clearAll);
  const audit = computeProgramAudit(tree.groups, status);
  const selectedCount = Object.keys(status).length;
  const percent = Math.round(audit.percentPlanned * 10) / 10;

  const handleClearAll = () => {
    const n = selectedCount;
    clearAll();
    if (n > 0) toast.success(`已清空 ${n} 条勾选记录`);
  };

  return (
    <div className="space-y-5">
      {/* Hero：缺口 / 进度双读数 + 横向进度条（紧凑单列） */}
      <Card className="border-primary/20 bg-gradient-to-br from-card to-accent">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <GraduationCap className="h-5 w-5 text-primary" />
                {tree.program.title}
              </CardTitle>
              <CardDescription className="mt-1">
                {tree.program.year} 学年入学 · 主修代码 {tree.program.code}
              </CardDescription>
            </div>
            {selectedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="gap-1.5 text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" /> 清空勾选
              </Button>
            )}
          </div>

          {/* 焦点行：回答「毕业还差多少 / 走到哪了」 */}
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div className="flex items-baseline gap-2">
              <span
                className={
                  "text-4xl font-semibold tabular-nums leading-none " +
                  (audit.remaining > 0 ? "text-warning" : "text-success")
                }
              >
                {audit.remaining}
              </span>
              <span className="text-sm text-muted-foreground">
                学分缺口{audit.remaining > 0 ? "（按当前计划）" : " · 已覆盖"}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums leading-none text-primary">
                {percent}%
              </span>
              <span className="text-sm text-muted-foreground">毕业进度（含计划）</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <MiniProgress
              label="已修"
              caption={`${audit.totalTaken} / ${audit.totalRequired} 学分`}
              value={audit.percentTaken}
              indicatorClassName="animate-progress-grow"
            />
            <MiniProgress
              label="含计划"
              caption={`${audit.totalPlanned} / ${audit.totalRequired} 学分`}
              value={audit.percentPlanned}
              indicatorClassName="bg-primary/45 animate-progress-grow"
            />
          </div>
        </CardContent>
      </Card>

      {/* 统计卡 ×4（图标 + 语义色） */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="要求总学分"
          value={audit.totalRequired}
          icon={BookOpen}
          tone="primary"
          hint={tree.program.title}
        />
        <StatCard
          label="已修学分"
          value={audit.totalTaken}
          icon={CheckCircle2}
          tone="success"
          hint={`已修进度 ${audit.percentTaken}%`}
        />
        <StatCard
          label="含计划学分"
          value={audit.totalPlanned}
          icon={CalendarClock}
          tone="primary"
          hint={`计划后 ${audit.percentPlanned}%`}
        />
        <StatCard
          label="计划后缺口"
          value={audit.remaining}
          icon={AlertTriangle}
          tone={audit.remaining > 0 ? "warning" : "success"}
          hint={audit.missingCount > 0 ? `涉及 ${audit.missingCount} 门课` : "无缺口课程"}
        />
      </div>

      {audit.missingCount > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <ListChecks className="h-3.5 w-3.5" />
          按当前计划，仍有 {audit.missingCount} 门缺口课程待安排（见下方各组提示）
        </p>
      )}

      {/* 各要求组进度 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {audit.groups.map((ga) => (
          <ProgressCard key={ga.group.id} audit={ga} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        学分进度由浏览器本地即时计算；勾选记录保存在本机（localStorage），不上传服务器。
        毕业审核以教务处官方认定为准，本工具仅供参考。
      </p>
    </div>
  );
}

function MiniProgress({
  label,
  caption,
  value,
  indicatorClassName,
}: {
  label: string;
  caption: string;
  value: number;
  indicatorClassName?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium tabular-nums text-foreground">{caption}</span>
      </div>
      <Progress value={value} className="h-2" indicatorClassName={indicatorClassName} />
    </div>
  );
}

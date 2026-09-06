import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ProgressCard } from "@/components/business/ProgressCard";
import { computeProgramAudit } from "@/lib/audit";
import { useSelection } from "@/stores/selection";
import { GraduationCap, ListChecks, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProgramTreeData } from "@/types";

export function OverviewPage({ tree }: { tree: ProgramTreeData }) {
  const status = useSelection((s) => s.status);
  const clearAll = useSelection((s) => s.clearAll);
  const audit = computeProgramAudit(tree.groups, status);
  const selectedCount = Object.keys(status).length;

  return (
    <div className="space-y-5">
      {/* 总进度仪表盘 */}
      <Card className="border-primary/20 bg-gradient-to-br from-card to-accent">
        <CardHeader className="pb-2">
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
              <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1.5 text-muted-foreground">
                <Trash2 className="h-3.5 w-3.5" /> 清空勾选
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="要求总学分" value={audit.totalRequired} />
            <Stat label="已修学分" value={audit.totalTaken} tone="success" />
            <Stat label="含计划学分" value={audit.totalPlanned} />
            <Stat label="计划后缺口" value={audit.remaining} tone={audit.remaining > 0 ? "warning" : "success"} />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>已修进度</span>
              <span className="font-medium tabular-nums">{audit.percentTaken}%</span>
            </div>
            <Progress value={audit.percentTaken} className="h-2.5" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>含计划进度</span>
              <span className="font-medium tabular-nums">{audit.percentPlanned}%</span>
            </div>
            <Progress value={audit.percentPlanned} className="h-2.5" indicatorClassName="bg-primary/45" />
          </div>

          {audit.missingCount > 0 && (
            <p className="text-xs text-warning flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" />
              按当前计划，仍有 {audit.missingCount} 门缺口课程待安排（见下方各组提示）
            </p>
          )}
        </CardContent>
      </Card>

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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  return (
    <div className="rounded-lg border bg-card/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 text-xl font-semibold tabular-nums " +
          (tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

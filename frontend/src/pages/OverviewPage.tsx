import { useMemo } from "react";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ProgressCard } from "@/components/business/ProgressCard";
import { CCProgressCard } from "@/components/business/CCProgressCard";
import { StatCard } from "@/components/business/StatCard";
import { computeProgramAudit } from "@/lib/audit";
import { computeCommonCoreAudit } from "@/lib/common-core";
import type { AttachedProgram } from "@/lib/attached";
import { AttachedAuditCard } from "@/components/business/AttachedAuditCard";
import { useSelection } from "@/stores/selection";
import { useProfile } from "@/stores/profile";
import {
  GraduationCap,
  ListChecks,
  Trash2,
  BookOpen,
  CheckCircle2,
  CalendarClock,
  AlertTriangle,
  Shapes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ProgramTreeData } from "@/types";

/** 附加要求（辅修/学院/EXTM）的视图条目：attached + 已加载树 */
export interface AttachedEntryView {
  attached: AttachedProgram;
  tree?: ProgramTreeData;
  isLoading: boolean;
  isError: boolean;
}

/** 方案总览：毕业总进度 = 主修 + 通识核心 + 附加要求（辅修/学院）合并口径 */
export function OverviewPage({
  tree,
  attachedEntries = [],
  onRemoveMinor,
}: {
  tree: ProgramTreeData;
  attachedEntries?: AttachedEntryView[];
  onRemoveMinor?: (code: string) => void;
}) {
  const status = useSelection((s) => s.status);
  const clearAll = useSelection((s) => s.clearAll);
  const profile = useProfile((s) => s.profile);
  const audit = computeProgramAudit(tree.groups, status);

  // 附加要求审计：每个可用附加方案独立计算（勾选按课号共享，credit reuse）
  const attachedAudits = useMemo(
    () =>
      attachedEntries.map((e) => ({
        ...e,
        audit: e.tree ? computeProgramAudit(e.tree.groups, status) : null,
      })),
    [attachedEntries, status]
  );
  const attachedUsable = attachedAudits.filter((a) => a.audit);

  // 通识核心审核：勾选记录 + profile（program/school/admissionYear）驱动
  const cc = useMemo(
    () =>
      computeCommonCoreAudit({
        courses: Object.entries(status).map(([code, s]) => ({ code, status: s })),
        program: tree.program.code,
        school: profile?.school ?? null,
        admissionYear: profile?.admissionYear ?? null,
      }),
    [status, tree.program.code, profile?.school, profile?.admissionYear]
  );

  // 合并口径：主修 + 通识 + 附加要求（一门课可同时计入多个要求，属官方允许的 credit reuse）
  const attachedReq = attachedUsable.reduce((s, a) => s + a.audit!.totalRequired, 0);
  const attachedTaken = attachedUsable.reduce((s, a) => s + a.audit!.totalTaken, 0);
  const attachedPlanned = attachedUsable.reduce((s, a) => s + a.audit!.totalPlanned, 0);
  const merged = useMemo(() => {
    const totalRequired = audit.totalRequired + cc.totalRequired + attachedReq;
    const takenTotal = audit.totalTaken + cc.totalTaken + attachedTaken;
    const plannedTotal = audit.totalPlanned + cc.totalCompleted + attachedPlanned;
    return {
      totalRequired,
      takenTotal,
      plannedTotal,
      remaining: Math.max(0, totalRequired - plannedTotal),
      percentTaken: totalRequired ? Math.round((takenTotal / totalRequired) * 100) : 0,
      percentPlanned: totalRequired ? Math.round((plannedTotal / totalRequired) * 100) : 0,
    };
  }, [audit, cc, attachedReq, attachedTaken, attachedPlanned]);

  // 通识三组 → 组卡数据（CCProgressCard 展示分桶明细）
  const ccCards = useMemo(
    () =>
      cc.groups.map((g) => ({
        group: g,
        required: g.buckets.reduce((s, b) => s + b.required, 0),
        taken: g.buckets.reduce((s, b) => s + b.takenCredits, 0),
        completed: g.buckets.reduce((s, b) => s + b.completedCredits, 0),
      })),
    [cc]
  );
  const selectedCount = Object.keys(status).length;

  const handleClearAll = () => {
    const n = selectedCount;
    clearAll();
    if (n > 0) toast.success(`已清空 ${n} 条勾选记录`);
  };

  return (
    <div className="space-y-5">
      {/* Hero：合并口径的缺口 / 进度双读数 + 横向进度条 */}
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

          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div className="flex items-baseline gap-2">
              <span
                className={
                  "text-4xl font-semibold tabular-nums leading-none " +
                  (merged.remaining > 0 ? "text-warning" : "text-success")
                }
              >
                {merged.remaining}
              </span>
              <span className="text-sm text-muted-foreground">
                学分缺口{merged.remaining > 0 ? "（按当前计划）" : " · 已覆盖"}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums leading-none text-primary">
                {merged.percentPlanned}%
              </span>
              <span className="text-sm text-muted-foreground">毕业进度（主修 + 通识核心）</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <MiniProgress
              label="已修"
              caption={`${merged.takenTotal} / ${merged.totalRequired} 学分`}
              value={merged.percentTaken}
              indicatorClassName="animate-progress-grow"
            />
            <MiniProgress
              label="含计划"
              caption={`${merged.plannedTotal} / ${merged.totalRequired} 学分`}
              value={merged.percentPlanned}
              indicatorClassName="bg-primary/45 animate-progress-grow"
            />
            <p className="text-xs text-muted-foreground">
              主修 {audit.totalPlanned}/{audit.totalRequired || "—"} · 通识核心 {cc.totalCompleted}/
              {cc.totalRequired}
              {attachedUsable.length > 0 &&
                ` · 附加要求 ${attachedPlanned}/${attachedReq}（${attachedUsable.length} 项）`}
              {cc.framework.susApplicable && "（2025-26 起含 SUS Area）"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 统计卡 ×4（合并口径，图标 + 语义色） */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="要求总学分"
          value={merged.totalRequired}
          icon={BookOpen}
          tone="primary"
          hint={`主修 ${audit.totalRequired || "—"} + 通识 ${cc.totalRequired}`}
        />
        <StatCard
          label="已修学分"
          value={merged.takenTotal}
          icon={CheckCircle2}
          tone="success"
          hint={`已修进度 ${merged.percentTaken}%`}
        />
        <StatCard
          label="含计划学分"
          value={merged.plannedTotal}
          icon={CalendarClock}
          tone="primary"
          hint={`计划后 ${merged.percentPlanned}%`}
        />
        <StatCard
          label="计划后缺口"
          value={merged.remaining}
          icon={AlertTriangle}
          tone={merged.remaining > 0 ? "warning" : "success"}
          hint={
            cc.unmatched.length > 0
              ? `另有 ${cc.unmatched.length} 门未匹配通识 Area`
              : audit.missingCount > 0
                ? `涉及 ${audit.missingCount} 门课`
                : "无缺口课程"
          }
        />
      </div>

      {audit.missingCount > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <ListChecks className="h-3.5 w-3.5" />
          按当前计划，主修仍有 {audit.missingCount} 门缺口课程待安排（见下方各组提示）
        </p>
      )}

      {/* 各要求组进度：主修 + 通识核心混排 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {audit.groups.map((ga) => (
          <ProgressCard key={`major-${ga.group.id}`} audit={ga} />
        ))}
        {ccCards.map(({ group, required, taken, completed }) => (
          <CCProgressCard
            key={`cc-${group.name}`}
            group={group}
            required={required}
            taken={taken}
            completed={completed}
          />
        ))}
      </div>

      {/* 附加要求：辅修 / 学院要求 / EXTM（叠加区块） */}
      {attachedEntries.length > 0 && (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Shapes className="h-4 w-4" />
            附加要求（辅修 / 学院）
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {attachedAudits.map(({ attached, tree: at, isLoading, isError, audit: aa }) => (
              <div key={attached.code} className="space-y-2">
                {!attached.available && (
                  <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                    {attached.label}：{attached.year} 学年暂无此要求数据
                  </p>
                )}
                {attached.available && isLoading && (
                  <div className="h-36 animate-pulse-soft rounded-lg bg-muted" />
                )}
                {attached.available && isError && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
                    {attached.label} 数据加载失败
                  </p>
                )}
                {attached.available && at && aa && (
                  <AttachedAuditCard
                    attached={attached}
                    tree={at}
                    onRemove={
                      attached.kind === "school"
                        ? undefined
                        : () => onRemoveMinor?.(attached.code)
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {cc.unmatched.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Shapes className="h-3.5 w-3.5" />
          {cc.unmatched.length} 门课程未匹配到通识 Area（不在官方课程清单内），不计入通识核心进度。
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        学分进度由浏览器本地即时计算；勾选记录保存在本机（localStorage），不上传服务器。
        通识核心替代规则以 AR 官网为准。毕业审核以教务处官方认定为准，本工具仅供参考。
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


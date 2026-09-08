import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressHero } from "@/components/business/ProgressHero";
import { GroupBarList, type GroupBarItem } from "@/components/business/GroupBarList";
import { StatCard } from "@/components/business/StatCard";
import { AttachedAuditCard } from "@/components/business/AttachedAuditCard";
import { computeProgramAudit } from "@/lib/audit";
import { computeCommonCoreAudit } from "@/lib/common-core";
import type { AttachedProgram } from "@/lib/attached";
import { useSelection } from "@/stores/selection";
import { useProfile } from "@/stores/profile";
import { AlertTriangle, BookOpen, CalendarClock, CheckCircle2, Shapes, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { GroupAudit, ProgramTreeData } from "@/types";

/** 附加要求（辅修/学院/EXTM）的视图条目：attached + 已加载树 */
export interface AttachedEntryView {
  attached: AttachedProgram;
  tree?: ProgramTreeData;
  isLoading: boolean;
  isError: boolean;
}

/** 要求组 → 占比条条目（主修与通识核心共用同一视觉契约） */
function toBarItem(audit: GroupAudit): GroupBarItem {
  const state: GroupBarItem["state"] = audit.isDone
    ? "done"
    : audit.plannedCredits > 0 || audit.takenCredits > 0
      ? "partial"
      : "todo";
  return {
    key: `major-${audit.group.id}`,
    name: audit.group.name,
    taken: audit.takenCredits,
    planned: audit.plannedCredits,
    required: audit.requiredCredits,
    courseCount: audit.group.courses.length,
    state,
    missingCodes: audit.missingCourses.map((c) => c.code),
  };
}

/**
 * 方案总览：单焦点仪表盘。
 * 第一屏只回答「还差多少」——巨型缺口数字 + 双口径分段进度条；
 * 第二屏是分组占比条（纵向扫读各组完成度）；最后是统计卡与附加要求。
 */
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

  // 通识三组 → 占比条条目（与主修组同列表呈现，避免两套视觉）
  const ccBarItems = useMemo<GroupBarItem[]>(
    () =>
      cc.groups.map((g) => {
        const required = g.buckets.reduce((s, b) => s + b.required, 0);
        const taken = g.buckets.reduce((s, b) => s + b.takenCredits, 0);
        const completed = g.buckets.reduce((s, b) => s + b.completedCredits, 0);
        return {
          key: `cc-${g.name}`,
          name: `通识核心 · ${g.name}`,
          taken,
          planned: completed,
          required,
          state: required > 0 && completed >= required ? "done" : completed > 0 ? "partial" : "todo",
        };
      }),
    [cc]
  );

  const majorBarItems = useMemo(() => audit.groups.map(toBarItem), [audit.groups]);
  const selectedCount = Object.keys(status).length;

  const handleClearAll = () => {
    const n = selectedCount;
    clearAll();
    if (n > 0) toast.success(`已清空 ${n} 条勾选记录`);
  };

  return (
    <div className="space-y-5">
      <ProgressHero
        title={tree.program.title}
        subtitle={`${tree.program.year} 学年入学 · 主修代码 ${tree.program.code}`}
        remaining={merged.remaining}
        totalRequired={merged.totalRequired}
        takenTotal={merged.takenTotal}
        plannedTotal={merged.plannedTotal}
        percentTaken={merged.percentTaken}
        percentPlanned={merged.percentPlanned}
        breakdown={
          <>
            合并口径：主修 {audit.totalPlanned}/{audit.totalRequired || "—"} · 通识核心{" "}
            {cc.totalCompleted}/{cc.totalRequired}
            {attachedUsable.length > 0 &&
              ` · 附加要求 ${attachedPlanned}/${attachedReq}（${attachedUsable.length} 项）`}
            {cc.framework.susApplicable && "（2025-26 起含 SUS Area）"}
          </>
        }
        action={
          selectedCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="gap-1.5 text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" /> 清空勾选
            </Button>
          ) : undefined
        }
      />

      {/* 统计卡 ×4（合并口径，图标 + 语义色） */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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

      {/* 主修分组占比条 */}
      <GroupBarList title="主修要求分组" items={majorBarItems} emptyHint="该方案暂无要求分组" />

      {/* 通识核心占比条 */}
      {ccBarItems.length > 0 && (
        <GroupBarList title="通识核心 Common Core" items={ccBarItems} />
      )}

      {/* 附加要求：辅修 / 学院要求 / EXTM（叠加区块） */}
      {attachedEntries.length > 0 && (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Shapes className="h-4 w-4" />
            附加要求（辅修 / 学院）
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <Card>
          <CardContent className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
            <Shapes className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {cc.unmatched.length} 门课程未匹配到通识 Area（不在官方课程清单内），不计入通识核心进度。
            </span>
          </CardContent>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        学分进度由浏览器本地即时计算；勾选记录保存在本机（localStorage），不上传服务器。
        通识核心替代规则以 AR 官网为准。毕业审核以教务处官方认定为准，本工具仅供参考。
      </p>
    </div>
  );
}

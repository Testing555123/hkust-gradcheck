import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { RequirementTree } from "@/components/business/RequirementTree";
import { CommonCoreSection } from "@/components/business/CommonCoreSection";
import { RequirementSection } from "@/components/business/RequirementSection";
import { FilterChips } from "@/components/business/FilterChips";
import { UncertainNotes } from "@/components/business/UncertainNotes";
import { BookOpen, FileText, GraduationCap, School, Shapes } from "lucide-react";
import type { AttachedEntryView } from "@/pages/OverviewPage";
import type { ProgramTreeData } from "@/types";
import { computeProgramAudit } from "@/lib/audit";
import { computeCommonCoreAudit } from "@/lib/common-core";
import {
  computeCcGroupFilterState,
  computeGroupFilterState,
  countByGroupStatus,
  GROUP_FILTER_OPTIONS,
  type GroupFilterState,
} from "@/lib/group-filter";
import { useSelection } from "@/stores/selection";
import { useProfile } from "@/stores/profile";

/**
 * 毕业要求明细页：主修 / 通识核心 / 附加要求 三块明显分隔的分区卡片，
 * 顶部一条 sticky 状态筛选 chips（全局计数），一键只看缺口、快速锁定目标组。
 */
export function RequirementsPage({
  tree,
  attachedEntries = [],
}: {
  tree: ProgramTreeData;
  attachedEntries?: AttachedEntryView[];
}) {
  const status = useSelection((s) => s.status);
  const profile = useProfile((s) => s.profile);
  const [filter, setFilter] = useState<GroupFilterState>("all");

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

  const majorAudit = useMemo(() => computeProgramAudit(tree.groups, status), [tree.groups, status]);
  const majorDone = useMemo(
    () => tree.groups.filter((g) => computeGroupFilterState(g, status) === "done").length,
    [tree.groups, status]
  );

  // 全局组状态计数（跨三类汇总），让用户一眼看到「还差多少」
  const counts = useMemo(() => {
    const states: GroupFilterState[] = [
      ...tree.groups.map((g) => computeGroupFilterState(g, status)),
      ...cc.groups.map(computeCcGroupFilterState),
      ...attachedEntries.flatMap((e) =>
        e.tree ? e.tree.groups.map((g) => computeGroupFilterState(g, status)) : []
      ),
    ];
    return countByGroupStatus(states);
  }, [tree.groups, cc.groups, attachedEntries, status]);

  const hasAttached = attachedEntries.some((e) => e.attached.available && e.tree);

  return (
    <div className="space-y-4">
      {/* 数据来源说明（保持原有可回溯信息） */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <FileText className="h-4 w-4" />
        <span>数据来源：官方培养方案 PDF</span>
        {tree.program.source_pdf && (
          <Badge variant="outline" className="font-mono text-[11px] max-w-[320px] truncate">
            {tree.program.source_pdf.split(/[\\/]/).pop()}
          </Badge>
        )}
        <span>· 每项要求均标注原文页码，可回溯核对</span>
        <UncertainNotes notes={tree.program.uncertain} />
      </div>

      {/* 顶部 sticky 状态筛选条：长列表滚动常驻，一键只看缺口 */}
      <div className="sticky top-[72px] z-30 -mx-4 bg-background/80 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <FilterChips value={filter} onChange={setFilter} counts={counts} options={GROUP_FILTER_OPTIONS} />
      </div>

      <div className="space-y-6">
        {/* 主修区 */}
        <RequirementSection
          icon={<GraduationCap className="h-4 w-4" />}
          title="主修要求"
          accent="primary"
          summary={
            <>
              已修 {majorAudit.totalTaken} / 要求 {majorAudit.totalRequired} 学分 ·{" "}
              {majorDone}/{tree.groups.length} 组达标
            </>
          }
        >
          <RequirementTree tree={tree} statusFilter={filter} />
        </RequirementSection>

        {/* 通识核心区 */}
        <RequirementSection
          icon={<Shapes className="h-4 w-4" />}
          title="通识核心 Common Core"
          accent="success"
          summary={
            <>
              已计 {cc.totalCompleted} / 要求 {cc.totalRequired} 学分
            </>
          }
        >
          <CommonCoreSection cc={cc} statusFilter={filter} />
        </RequirementSection>

        {/* 附加要求区（有可用数据才渲染，避免空标题） */}
        {hasAttached && (
          <RequirementSection
            icon={<BookOpen className="h-4 w-4" />}
            title="附加要求（辅修 / Extended Major / 学院）"
            accent="warning"
          >
            {attachedEntries.map(({ attached, tree: at, isLoading, isError }) => (
              <div key={attached.code} className="space-y-3">
                <div className="flex items-center gap-2 border-t border-dashed pt-4 first:border-t-0 first:pt-0">
                  {attached.kind === "school" ? (
                    <School className="h-4 w-4 text-warning" />
                  ) : (
                    <BookOpen className="h-4 w-4 text-warning" />
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
                {attached.available && at && <RequirementTree tree={at} statusFilter={filter} />}
              </div>
            ))}
          </RequirementSection>
        )}
      </div>
    </div>
  );
}

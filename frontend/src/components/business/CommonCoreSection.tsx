import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleGroup } from "@/components/business/CollapsibleGroup";
import { EmptyState } from "@/components/ui/empty";
import { CCBucketBlock } from "@/components/business/CommonCoreCourses";
import { Shapes } from "lucide-react";
import type { CommonCoreAudit } from "@/lib/common-core";
import {
  computeCcGroupFilterState,
  matchesGroupFilter,
  type GroupFilterState,
} from "@/lib/group-filter";

const GROUP_NAMES: Record<string, string> = {
  Foundations: "基础",
  Broadening: "拓展",
  Experiencing: "体验",
};

/**
 * 要求明细页的通识核心区块：三组 + 各 Area 分桶（cc 由父级 RequirementsPage 统一核算后传入，
 * 避免与全局计数重复计算）。按组状态筛选隐藏不匹配的组。
 */
export function CommonCoreSection({
  cc,
  statusFilter = "all",
}: {
  cc: CommonCoreAudit;
  statusFilter?: GroupFilterState;
}) {
  const notApplicableAreas = useMemo(() => {
    const areas: string[] = [];
    if (!cc.framework.susApplicable) areas.push("SUS");
    if (!cc.framework.haicApplicable) areas.push("HAIC");
    return areas;
  }, [cc.framework.susApplicable, cc.framework.haicApplicable]);

  const visibleGroups = cc.groups.filter((g) =>
    matchesGroupFilter(computeCcGroupFilterState(g), statusFilter)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>通识核心 Common Core（30 学分框架）</span>
        <Badge variant="outline" className="font-normal">
          {cc.framework.susApplicable ? "2025-26 起含 SUS" : "2022-23 起框架"}
        </Badge>
        {cc.framework.haicApplicable && (
          <Badge variant="outline" className="font-normal">
            2026-27 起含 HAIC
          </Badge>
        )}
        {notApplicableAreas.length > 0 && (
          <span>你的入学学年不设 {notApplicableAreas.join(" / ")} 桶</span>
        )}
      </div>

      {visibleGroups.length === 0 ? (
        <EmptyState
          icon={<Shapes className="h-8 w-8 mx-auto text-muted-foreground" />}
          title="该分类下没有匹配的要求组"
          description="试试切换上方筛选条件，或先去「课程选择」勾选已修课程"
        />
      ) : (
        visibleGroups.map((g) => {
          const required = g.buckets.reduce((s, b) => s + b.required, 0);
          const completed = g.buckets.reduce((s, b) => s + b.completedCredits, 0);
          const allMet = g.buckets.every((b) => b.completedCredits >= b.required);
          const done = allMet && required > 0;
          return (
            <CollapsibleGroup
              key={g.name}
              title={
                <span>
                  通识核心 · {GROUP_NAMES[g.name] ?? g.name}（{g.name}）
                </span>
              }
              done={done}
              summary={`已计 ${completed} / 要求 ${required} 学分`}
              headerExtra={
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {required} credits
                </Badge>
              }
            >
              <div className="space-y-4">
                {g.note && (
                  <div className="rounded-md border-l-4 border-primary/40 bg-muted/60 px-3 py-2">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground/80">说明：</span>
                      {g.note}
                    </p>
                  </div>
                )}
                {g.buckets.map((b) => (
                  <CCBucketBlock key={b.label} bucket={b} notApplicableAreas={notApplicableAreas} />
                ))}
              </div>
            </CollapsibleGroup>
          );
        })
      )}

      {cc.unmatched.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <Shapes className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {cc.unmatched.length} 门课程未匹配到通识 Area（不在官方课程清单内），不计入通识核心进度：
            {cc.unmatched.map((u) => u.code).join("、")}
          </span>
        </div>
      )}
    </div>
  );
}

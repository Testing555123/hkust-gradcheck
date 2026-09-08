import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CourseRow } from "@/components/business/CourseRow";
import { CollapsibleGroup } from "@/components/business/CollapsibleGroup";
import { EmptyState } from "@/components/ui/empty";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSelection } from "@/stores/selection";
import { computeGroupAudit } from "@/lib/audit";
import { sortTakenFirst } from "@/lib/pools";
import { computeGroupFilterState, matchesGroupFilter, type GroupFilterState } from "@/lib/group-filter";
import { FileText, Info, StickyNote } from "lucide-react";
import type { CourseRef, ProgramTreeData, RequirementGroup } from "@/types";

/** 按课程行渲染一批课程（去重） */
function CourseRows({ courses }: { courses: CourseRef[] }) {
  const seen = new Set<string>();
  const unique = courses.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
  return (
    <div className="space-y-2">
      {unique.map((c) => (
        <CourseRow key={c.code} course={c} />
      ))}
    </div>
  );
}

/** Electives 组：按 Area 分块渲染（同课多 Area 会在多块出现），未分类归入独立块 */
function AreaBlocks({ courses }: { courses: CourseRef[] }) {
  const areaMap = new Map<string, CourseRef[]>();
  const unclassified: CourseRef[] = [];
  for (const c of courses) {
    if (c.areas && c.areas.length > 0) {
      for (const a of c.areas) {
        areaMap.set(a, [...(areaMap.get(a) ?? []), c]);
      }
    } else {
      unclassified.push(c);
    }
  }

  return (
    <div className="space-y-4">
      {[...areaMap.entries()].map(([area, cs]) => (
        <div key={area}>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="text-primary border-primary/40">
              {area}
            </Badge>
            <span className="text-xs text-muted-foreground">{new Set(cs.map((c) => c.code)).size} 门</span>
          </div>
          <CourseRows courses={cs} />
        </div>
      ))}
      {unclassified.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">Courses Without Associated Area</Badge>
            <span className="text-xs text-muted-foreground">{unclassified.length} 门</span>
          </div>
          <CourseRows courses={unclassified} />
        </div>
      )}
    </div>
  );
}

/** 单要求组：折叠卡 + 课程清单。开放式层级池组（pool）限顯示前 10 门、已讀優先、可「顯示全部」 */
function RequirementGroupView({
  group,
  defaultOpen,
}: {
  group: RequirementGroup;
  /** 初始开合：移动端默认折叠（只扫组进度），桌面展开 */
  defaultOpen?: boolean;
}) {
  const status = useSelection((s) => s.status);
  const [showAll, setShowAll] = useState(false);
  const audit = computeGroupAudit(group, status);
  const isPool = !!group.pool;

  const takenCount = group.courses.filter((c) => status[c.code] === "taken").length;
  const plannedCount = group.courses.filter((c) => status[c.code] === "planned").length;
  const hasAreas = group.courses.some((c) => c.areas && c.areas.length > 0);

  // 池组：已讀優先排序，默认仅顯示前 10 门（不记忆，切方案/刷新重算）
  const sorted = useMemo(
    () => (isPool ? sortTakenFirst(group.courses, status) : group.courses),
    [isPool, group.courses, status]
  );
  const visible = isPool && !showAll ? sorted.slice(0, 10) : sorted;

  const summary =
    audit.requiredCredits > 0
      ? `已修 ${audit.takenCredits} / 要求 ${audit.requiredCredits} 学分`
      : "开放选修";

  return (
    <CollapsibleGroup
      title={group.name}
      done={audit.isDone}
      summary={summary}
      defaultOpen={defaultOpen}
      progress={audit.percentTaken}
      headerExtra={
        <>
          {group.source_ref && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <FileText className="h-3 w-3" /> {group.source_ref}
            </span>
          )}
          <Badge variant="outline" className="shrink-0 tabular-nums">
            {group.required_credits} credits
          </Badge>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            要求 <strong className="text-foreground">{group.required_credits}</strong> 学分
          </span>
          <span>共 {group.courses.length} 门课</span>
          {takenCount > 0 && <span className="text-success">已修 {takenCount}</span>}
          {plannedCount > 0 && <span className="text-primary">计划 {plannedCount}</span>}
        </p>
        {group.min_courses != null && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" /> 至少修读 {group.min_courses} 门
          </p>
        )}
        {/* 官方 Note 说明（来自 PDF 原文） */}
        {group.note && (
          <div className="rounded-md border-l-4 border-primary/40 bg-muted/60 px-3 py-2">
            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
              <StickyNote className="mr-1.5 inline h-3.5 w-3.5 align-[-2px] text-primary/70" />
              <span className="font-medium text-foreground/80">官方说明：</span>
              {group.note}
            </p>
          </div>
        )}
        {group.courses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            该组未列出具体课程（请参考上方官方说明的选课规则）
          </p>
        ) : hasAreas ? (
          <AreaBlocks courses={group.courses} />
        ) : (
          <>
            {visible.map((c) => (
              <CourseRow key={`${group.id}-${c.code}`} course={c} />
            ))}
            {isPool && sorted.length > 10 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full text-muted-foreground"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "收起" : `顯示全部 ${sorted.length} 門`}
              </Button>
            )}
          </>
        )}
      </div>
    </CollapsibleGroup>
  );
}

/** 毕业要求明细树：按组展示课程清单、学分要求、Note 说明与 Area 分类；按组状态筛选隐藏不匹配的组 */
export function RequirementTree({
  tree,
  statusFilter = "all",
}: {
  tree: ProgramTreeData;
  statusFilter?: GroupFilterState;
}) {
  const status = useSelection((s) => s.status);
  const isDesktop = useIsDesktop();
  const visible = tree.groups.filter((g) =>
    matchesGroupFilter(computeGroupFilterState(g, status), statusFilter)
  );

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8 mx-auto text-muted-foreground" />}
        title="该分类下没有匹配的要求组"
        description="试试切换上方筛选条件，或先去「课程选择」勾选已修课程"
      />
    );
  }

  return (
    <div className="space-y-4">
      {visible.map((g) => (
        <RequirementGroupView
          key={`${tree.program.code}-${g.id}`}
          group={g}
          // 移动端默认折叠：先让用户纵向扫读各组进度，再按需展开
          defaultOpen={isDesktop ? undefined : false}
        />
      ))}
    </div>
  );
}

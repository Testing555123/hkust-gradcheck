import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CourseRow } from "@/components/business/CourseRow";
import { ComboRow } from "@/components/business/ComboRow";
import { CollapsibleGroup } from "@/components/business/CollapsibleGroup";
import { BranchKindBadge } from "@/components/business/BranchSelector";
import { EmptyState } from "@/components/ui/empty";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSelection } from "@/stores/selection";
import { computeGroupAudit } from "@/lib/audit";
import { collectBranches } from "@/lib/branch";
import { comboCodes, effectiveCourseCount, effectiveCourses } from "@/lib/combos";
import { sortTakenFirst } from "@/lib/pools";
import { computeGroupFilterState, matchesGroupFilter, type GroupFilterState } from "@/lib/group-filter";
import { cn } from "@/lib/utils";
import { ChevronDown, FileText, Info, StickyNote } from "lucide-react";
import type { BranchOption, CourseRef, ProgramTreeData, RequirementGroup } from "@/types";

/** 按课程行渲染一批课程（去重） */
function CourseRows({ courses, offBranch }: { courses: CourseRef[]; offBranch?: string | null }) {
  const seen = new Set<string>();
  const unique = courses.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
  return (
    <div className="space-y-2">
      {unique.map((c) => (
        <CourseRow key={c.code} course={c} offBranch={offBranch} />
      ))}
    </div>
  );
}

/** Electives 组：按 Area 分块渲染（同课多 Area 会在多块出现），未分类归入独立块 */
function AreaBlocks({
  courses,
  offBranch,
}: {
  courses: CourseRef[];
  offBranch?: string | null;
}) {
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
          <CourseRows courses={cs} offBranch={offBranch} />
        </div>
      ))}
      {unclassified.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">Courses Without Associated Area</Badge>
            <span className="text-xs text-muted-foreground">{unclassified.length} 门</span>
          </div>
          <CourseRows courses={unclassified} offBranch={offBranch} />
        </div>
      )}
    </div>
  );
}

/** 单要求组：折叠卡 + 课程清单。开放式层级池组（pool）限顯示前 10 门、已讀優先、可「顯示全部」 */
function RequirementGroupView({
  group,
  defaultOpen,
  offBranch = null,
}: {
  group: RequirementGroup;
  /** 初始开合：移动端默认折叠（只扫组进度），桌面展开 */
  defaultOpen?: boolean;
  /** 该组所属分支不是当前已选方向时传分支名：整组降透明度，课程行标注「非当前方向」 */
  offBranch?: string | null;
}) {
  const status = useSelection((s) => s.status);
  const [showAll, setShowAll] = useState(false);
  const audit = computeGroupAudit(group, status);
  const isPool = !!group.pool;
  const kind: BranchOption["kind"] | null =
    group.branch_kind === "option" ? "option" : group.branch ? "track" : null;

  // OR 组合（二选一）：组合内的课同时平铺在 courses 中，渲染前先剔除，避免重复显示
  const combos = group.combos ?? [];
  const inCombo = useMemo(() => comboCodes(group), [group]);
  const plain = useMemo(
    () => group.courses.filter((c) => !inCombo.has(c.code)),
    [group.courses, inCombo]
  );

  // 门数与已修/计划计数一律走「有效课程」口径：组合按 1 门计
  const effective = useMemo(() => effectiveCourses(group, status), [group, status]);
  const takenCount = effective.filter((c) => status[c.code] === "taken").length;
  const plannedCount = effective.filter((c) => status[c.code] === "planned").length;
  const hasAreas = plain.some((c) => c.areas && c.areas.length > 0);

  // 池组：已讀優先排序，默认仅顯示前 10 门（不记忆，切方案/刷新重算）
  const sorted = useMemo(
    () => (isPool ? sortTakenFirst(plain, status) : plain),
    [isPool, plain, status]
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
      className={offBranch ? "opacity-70" : undefined}
      headerExtra={
        <>
          {kind && <BranchKindBadge kind={kind} />}
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
          <span>共 {effectiveCourseCount(group)} 门课</span>
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
        {/* OR 组合（二选一 / 多选一）：整组只按一门计入学分，故优先于课程清单渲染 */}
        {combos.length > 0 && (
          <div className="space-y-2">
            {combos.map((combo, index) => (
              <ComboRow
                key={`${group.id}-combo-${index}`}
                combo={combo}
                offBranch={offBranch}
                sourceRef={group.source_ref}
              />
            ))}
          </div>
        )}
        {combos.length === 0 && plain.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            该组未列出具体课程（请参考上方官方说明的选课规则）
          </p>
        ) : hasAreas ? (
          <AreaBlocks courses={visible} offBranch={offBranch} />
        ) : (
          <>
            {visible.map((c) => (
              <CourseRow key={`${group.id}-${c.code}`} course={c} offBranch={offBranch} />
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

/** 需要项目办公室批准 / 需跟随另一 Track 的分支：原样透传官方说明，不做自动展开计算 */
const FOLLOW_HINTS = ["approval", "follow the curriculum", "follow the applied", "follow one of"];

function FollowNoteCard({ notes }: { notes: string[] }) {
  const hit = notes.find((n) => FOLLOW_HINTS.some((h) => n.toLowerCase().includes(h)));
  if (!hit) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
      <p className="text-caption leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">需项目办公室批准，课程跟随指定 Track：</span>
        {hit}
      </p>
    </div>
  );
}

/** 单个分支区块：头部（名称 + 类型 + 学分）+ 可折叠的组列表 + 二级分支缩进块 */
function BranchBlock({
  branch,
  groups,
  childGroups,
  active,
  isDesktop,
  selectedBranch,
  selectedSubBranch,
}: {
  branch: BranchOption;
  groups: RequirementGroup[];
  childGroups: (child: BranchOption) => RequirementGroup[];
  active: boolean;
  isDesktop: boolean;
  selectedBranch: string | null;
  selectedSubBranch: string | null;
}) {
  const [open, setOpen] = useState(active);
  const notes = groups.map((g) => g.note).filter((n): n is string => Boolean(n));

  return (
    <div className={cn("rounded-lg border p-3 sm:p-4", active ? "border-primary/30 bg-primary/[0.03]" : "bg-muted/20")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast",
              !open && "-rotate-90"
            )}
          />
          <span
            className={cn(
              "truncate text-sm font-semibold tracking-tight",
              !active && "text-muted-foreground"
            )}
          >
            {branch.name}
          </span>
          <BranchKindBadge kind={branch.kind} />
          {active && (
            <Badge variant="outline" className="shrink-0 border-primary/40 text-primary">
              当前方向
            </Badge>
          )}
        </span>
        <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
          {branch.credits} 学分
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 animate-fade-in-up">
          <FollowNoteCard notes={notes} />
          {groups.map((g) => (
            <RequirementGroupView
              key={g.id}
              group={g}
              defaultOpen={isDesktop ? undefined : false}
              offBranch={active ? null : branch.name}
            />
          ))}
          {branch.children.map((child) => {
            const childActive = selectedSubBranch === child.name;
            return (
              <div key={child.name} className="border-l border-border pl-2 sm:pl-4">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "truncate text-caption font-medium",
                      childActive ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {child.name}
                  </span>
                  <BranchKindBadge kind={child.kind} />
                  <span className="text-caption tabular-nums text-muted-foreground">
                    +{child.credits} 学分
                  </span>
                  {!childActive && selectedBranch === branch.name && (
                    <span className="text-caption text-muted-foreground">（未勾选，不计入进度）</span>
                  )}
                </div>
                <div className="space-y-3">
                  {childGroups(child).map((g) => (
                    <RequirementGroupView
                      key={g.id}
                      group={g}
                      defaultOpen={childActive ? undefined : false}
                      offBranch={childActive ? null : child.name}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 毕业要求明细树：按组展示课程清单、学分要求、Note 说明与 Area 分类；按组状态筛选隐藏不匹配的组。
 *
 * 含互斥分支（Track / Option）时改为「公共核心 + 各分支区块」两段结构：
 * 分支区块默认只展示已选方向，其余折叠为一行，避免 8 个 Track 纵向铺开淹没核心课。
 */
export function RequirementTree({
  tree,
  statusFilter = "all",
  selectedBranch = null,
  selectedSubBranch = null,
}: {
  tree: ProgramTreeData;
  statusFilter?: GroupFilterState;
  /** 已选一级分支（来自 profile） */
  selectedBranch?: string | null;
  /** 已选二级分支 */
  selectedSubBranch?: string | null;
}) {
  const status = useSelection((s) => s.status);
  const isDesktop = useIsDesktop();
  const visible = tree.groups.filter((g) =>
    matchesGroupFilter(computeGroupFilterState(g, status), statusFilter)
  );

  const summary = useMemo(() => collectBranches(visible), [visible]);
  const groupsOf = (branch: BranchOption) => visible.filter((g) => g.branch === branch.name);

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8 mx-auto text-muted-foreground" />}
        title="该分类下没有匹配的要求组"
        description="试试切换上方筛选条件，或先去「课程选择」勾选已修课程"
      />
    );
  }

  if (!summary.hasBranches) {
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

  const core = visible.filter((g) => !g.branch);
  return (
    <div className="space-y-4">
      {core.length > 0 && (
        <div className="space-y-4">
          <p className="text-caption font-medium text-muted-foreground">
            公共核心（所有方向共同要求）
          </p>
          {core.map((g) => (
            <RequirementGroupView
              key={`${tree.program.code}-${g.id}`}
              group={g}
              defaultOpen={isDesktop ? undefined : false}
            />
          ))}
        </div>
      )}
      <div className="space-y-3">
        <p className="text-caption font-medium text-muted-foreground">
          方向要求（Track / Option，择一修读）
        </p>
        {summary.branches.map((b) => (
          <BranchBlock
            key={b.name}
            branch={b}
            groups={groupsOf(b)}
            childGroups={groupsOf}
            active={selectedBranch === b.name}
            isDesktop={isDesktop}
            selectedBranch={selectedBranch}
            selectedSubBranch={selectedSubBranch}
          />
        ))}
      </div>
    </div>
  );
}

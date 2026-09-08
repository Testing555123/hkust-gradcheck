import { useMemo, useState } from "react";
import { Search, SearchX, Shapes } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { CourseRow } from "@/components/business/CourseRow";
import { FilterChips } from "@/components/business/FilterChips";
import { CCGroupPanel } from "@/components/business/CommonCoreCourses";
import { computeCommonCoreAudit } from "@/lib/common-core";
import { useSelection } from "@/stores/selection";
import { useProfile } from "@/stores/profile";
import {
  applyFilter,
  attachStatus,
  countByStatus,
  type CourseFilterState,
  type FlatCourseWithStatus,
} from "@/lib/course-filter";

const COURSE_FILTER_OPTIONS: { value: CourseFilterState; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "taken", label: "已修" },
  { value: "planned", label: "计划" },
  { value: "none", label: "未选" },
];
import type { AttachedEntryView } from "@/pages/OverviewPage";
import type { ProgramTreeData } from "@/types";

interface FlatCourse {
  code: string;
  name: string;
  credits: number;
  groupNames: string[];
  areas?: string[];
  sourceRef?: string | null;
}

/** 课程浏览与勾选页：状态筛选 chips + 搜索，双状态勾选即时联动进度 */
export function CoursesPage({
  tree,
  attachedEntries = [],
}: {
  tree: ProgramTreeData;
  attachedEntries?: AttachedEntryView[];
}) {
  const status = useSelection((s) => s.status);
  const profile = useProfile((s) => s.profile);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<CourseFilterState>("all");

  // 通识核心审核（与要求明细页同源）：勾选即联动进度
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
  const notApplicableAreas = useMemo(() => {
    const areas: string[] = [];
    if (!cc.framework.susApplicable) areas.push("SUS");
    if (!cc.framework.haicApplicable) areas.push("HAIC");
    return areas;
  }, [cc.framework.susApplicable, cc.framework.haicApplicable]);

  const collect = (
    source: ProgramTreeData,
    sourceLabel: string | null,
    into: Map<string, FlatCourse>
  ) => {
    for (const g of source.groups) {
      for (const c of g.courses) {
        const prefix = sourceLabel ? `${sourceLabel} · ${g.name}` : g.name;
        const existing = into.get(c.code);
        if (existing) {
          if (!existing.groupNames.includes(prefix)) existing.groupNames.push(prefix);
        } else {
          into.set(c.code, {
            code: c.code,
            name: c.name,
            credits: c.credits,
            groupNames: [prefix],
            areas: c.areas,
          });
        }
      }
    }
  };

  const courses = useMemo<FlatCourse[]>(() => {
    const byCode = new Map<string, FlatCourse>();
    collect(tree, null, byCode);
    for (const e of attachedEntries) {
      if (e.tree) collect(e.tree, e.attached.label, byCode);
    }
    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [tree, attachedEntries]);

  // 状态附加与计数基于全量列表（计数不随搜索词变化，语义是"我有几门已修"）
  const withStatus = useMemo<FlatCourseWithStatus[]>(
    () => attachStatus(courses, status),
    [courses, status]
  );
  const counts = useMemo(() => countByStatus(withStatus), [withStatus]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const byKeyword = kw
      ? withStatus.filter(
          (c) =>
            c.code.toLowerCase().includes(kw) ||
            c.name.toLowerCase().includes(kw) ||
            c.groupNames.some((g) => g.toLowerCase().includes(kw))
        )
      : withStatus;
    return applyFilter(byKeyword, filter);
  }, [withStatus, keyword, filter]);

  const hasActiveConstraint = keyword.trim() !== "" || filter !== "all";

  return (
    <div className="space-y-4">
      {/* 搜索与筛选吸顶：移动端滚动时保持可达（顶栏 56px） */}
      <div className="sticky top-14 z-30 -mx-3 space-y-2 bg-background/85 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:mx-0 sm:px-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索课号、课程名或要求组…"
              className="h-10 pl-8 md:h-9"
            />
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {filtered.length} / {courses.length} 门
          </Badge>
        </div>

        <FilterChips
          value={filter}
          onChange={setFilter}
          counts={counts}
          options={COURSE_FILTER_OPTIONS}
        />
      </div>

      <div className="space-y-2">
        {filtered.map((c) => (
          <CourseRow
            key={c.code}
            course={{ code: c.code, name: c.name, credits: c.credits }}
            groupName={c.groupNames.join(" / ")}
          />
        ))}
        {filtered.length === 0 && (
          <EmptyState
            size="sm"
            variant={keyword.trim() ? "search" : "filter"}
            icon={<SearchX className="mx-auto h-10 w-10 text-muted-foreground" />}
            title="没有匹配的课程"
            description={
              keyword.trim()
                ? `没有课程匹配「${keyword.trim()}」${filter !== "all" ? "，或都被状态筛选过滤掉了" : ""}`
                : "当前状态下没有课程"
            }
            action={
              hasActiveConstraint ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setKeyword("");
                    setFilter("all");
                  }}
                >
                  清除搜索与筛选
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      {/* 通识核心：按基础 / 拓展 / 体验三组折叠，勾选与进度联动（不参与顶部主修搜索） */}
      <div className="space-y-2 pt-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
          <Shapes className="h-4 w-4" />
          通识核心 Common Core
          {notApplicableAreas.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              （你的入学学年不设 {notApplicableAreas.join(" / ")} 桶）
            </span>
          )}
        </div>
        {cc.groups.map((g) => (
          <CCGroupPanel key={g.name} group={g} notApplicableAreas={notApplicableAreas} />
        ))}
      </div>
    </div>
  );
}

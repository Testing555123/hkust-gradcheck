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
import { useCourses } from "@/hooks/queries";
import {
  applyFilter,
  attachStatus,
  countByStatus,
  extractSubjectPrefixes,
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
  const [subjectPrefix, setSubjectPrefix] = useState<string | null>(null);

  // 全校课程库（已缓存，由方案树加载时触发）：提取全部学科前缀供网格筛选
  const coursesAll = useCourses();
  const prefixes = useMemo(
    () => extractSubjectPrefixes(coursesAll.data ?? []),
    [coursesAll.data]
  );

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

  // 全校课程目录（已缓存）与方案课合并：方案课优先（保留 groupNames/areas），
  // 目录里不在方案的课（学科/方向外课程）也进入候选，使任意课都可勾选。
  const fullCourses = useMemo<FlatCourse[]>(() => {
    const byCode = new Map<string, FlatCourse>();
    for (const c of courses) byCode.set(c.code, c);
    for (const d of coursesAll.data ?? []) {
      if (!byCode.has(d.code)) {
        byCode.set(d.code, {
          code: d.code,
          name: d.title,
          credits: parseFloat(d.credits ?? "") || 0,
          groupNames: [],
        });
      }
    }
    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [courses, coursesAll.data]);

  // 未搜索/未选学科时只显示方案课（保持页面短）；一旦选了学科或输入搜索词，
  // 切换到「方案课 + 全校目录」合并集，以便勾选任意学科/方案外的课程。
  const searching = keyword.trim() !== "" || subjectPrefix != null;
  const source = searching ? fullCourses : courses;

  // 状态附加与计数：基于当前展示集合（计数不随搜索词变化，语义是"我有几门已修"）
  const withStatus = useMemo<FlatCourseWithStatus[]>(
    () => attachStatus(source, status),
    [source, status]
  );
  const counts = useMemo(() => countByStatus(withStatus), [withStatus]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = kw
      ? withStatus.filter(
          (c) =>
            c.code.toLowerCase().includes(kw) ||
            c.name.toLowerCase().includes(kw) ||
            c.groupNames.some((g) => g.toLowerCase().includes(kw))
        )
      : withStatus;
    if (subjectPrefix) {
      const p = subjectPrefix.toUpperCase();
      list = list.filter((c) => c.code.toUpperCase().startsWith(p));
    }
    return applyFilter(list, filter);
  }, [withStatus, keyword, filter, subjectPrefix]);

  const hasActiveConstraint = keyword.trim() !== "" || filter !== "all" || subjectPrefix != null;

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
            {filtered.length} / {source.length} 门
          </Badge>
        </div>

        <FilterChips
          value={filter}
          onChange={setFilter}
          counts={counts}
          options={COURSE_FILTER_OPTIONS}
        />
      </div>

      {/* 学科代码筛选：多列紧凑网格，参考 Class Schedule & Quota 风格，仅显示学科代码、无数量 */}
      {prefixes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">按学科筛选</span>
            <Button
              type="button"
              size="sm"
              variant={subjectPrefix === null ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              aria-pressed={subjectPrefix === null}
              onClick={() => setSubjectPrefix(null)}
            >
              全部
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {prefixes.map((p) => {
              const active = subjectPrefix === p.code;
              return (
                <Button
                  key={p.code}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 w-full px-1 text-xs font-medium"
                  aria-pressed={active}
                  onClick={() => setSubjectPrefix(active ? null : p.code)}
                >
                  {p.code}
                </Button>
              );
            })}
          </div>
        </div>
      )}

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
                    setSubjectPrefix(null);
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
          <CCGroupPanel
            key={g.name}
            group={g}
            notApplicableAreas={notApplicableAreas}
            subjectPrefix={subjectPrefix}
          />
        ))}
      </div>
    </div>
  );
}

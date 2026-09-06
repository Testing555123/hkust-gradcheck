import { useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { CourseRow } from "@/components/business/CourseRow";
import { FilterChips } from "@/components/business/FilterChips";
import { useSelection } from "@/stores/selection";
import {
  applyFilter,
  attachStatus,
  countByStatus,
  type CourseFilterState,
  type FlatCourseWithStatus,
} from "@/lib/course-filter";
import type { ProgramTreeData } from "@/types";

interface FlatCourse {
  code: string;
  name: string;
  credits: number;
  groupNames: string[];
  sourceRef?: string | null;
}

/** 课程浏览与勾选页：状态筛选 chips + 搜索，双状态勾选即时联动进度 */
export function CoursesPage({ tree }: { tree: ProgramTreeData }) {
  const status = useSelection((s) => s.status);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<CourseFilterState>("all");

  const courses = useMemo<FlatCourse[]>(() => {
    const byCode = new Map<string, FlatCourse>();
    for (const g of tree.groups) {
      for (const c of g.courses) {
        const existing = byCode.get(c.code);
        if (existing) {
          if (!existing.groupNames.includes(g.name)) existing.groupNames.push(g.name);
        } else {
          byCode.set(c.code, {
            code: c.code,
            name: c.name,
            credits: c.credits,
            groupNames: [g.name],
          });
        }
      }
    }
    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [tree]);

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
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索课号、课程名或要求组…"
            className="pl-8"
          />
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {filtered.length} / {courses.length} 门
        </Badge>
      </div>

      <FilterChips value={filter} onChange={setFilter} counts={counts} />

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
            icon={<SearchX className="h-10 w-10 mx-auto text-muted-foreground" />}
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
    </div>
  );
}

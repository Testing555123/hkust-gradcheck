import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CourseRow } from "@/components/business/CourseRow";
import { Search } from "lucide-react";
import type { ProgramTreeData } from "@/types";

interface FlatCourse {
  code: string;
  name: string;
  credits: number;
  groupNames: string[];
  sourceRef?: string | null;
}

/** 课程浏览与勾选页：展示培养方案内全部课程，支持搜索，双状态勾选 */
export function CoursesPage({ tree }: { tree: ProgramTreeData }) {
  const [keyword, setKeyword] = useState("");

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

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return courses;
    return courses.filter(
      (c) =>
        c.code.toLowerCase().includes(kw) ||
        c.name.toLowerCase().includes(kw) ||
        c.groupNames.some((g) => g.toLowerCase().includes(kw))
    );
  }, [courses, keyword]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
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

      <div className="space-y-2">
        {filtered.map((c) => (
          <CourseRow
            key={c.code}
            course={{ code: c.code, name: c.name, credits: c.credits }}
            groupName={c.groupNames.join(" / ")}
          />
        ))}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            没有匹配「{keyword}」的课程
          </p>
        )}
      </div>
    </div>
  );
}

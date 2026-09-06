import { cn } from "@/lib/utils";
import type { CourseFilterState } from "@/lib/course-filter";

interface FilterChipsProps {
  value: CourseFilterState;
  onChange: (next: CourseFilterState) => void;
  counts: Record<CourseFilterState, number>;
  className?: string;
}

const OPTIONS: { value: CourseFilterState; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "taken", label: "已修" },
  { value: "planned", label: "计划" },
  { value: "none", label: "未选" },
];

/** 课程状态筛选 chips（cal.com / dub 式）：选中实底 primary，其余 outline，带实时计数 */
export function FilterChips({ value, onChange, counts, className }: FilterChipsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="按状态筛选">
      {OPTIONS.map(({ value: v, label }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-input bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            {label}
            <span
              className={cn(
                "tabular-nums rounded-full px-1.5 text-[10px] leading-4",
                active ? "bg-primary-foreground/20" : "bg-muted"
              )}
            >
              {counts[v]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

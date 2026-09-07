import { cn } from "@/lib/utils";

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
}

interface FilterChipsProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  counts: Record<T, number>;
  /** 选项由调用方传入，便于同时服务课程态与要求组态（视觉/交互不变） */
  options: FilterChipOption<T>[];
  className?: string;
}

/** 状态筛选 chips（cal.com / dub 式）：选中实底 primary，其余 outline，带实时计数 */
export function FilterChips<T extends string>({
  value,
  onChange,
  counts,
  options,
  className,
}: FilterChipsProps<T>) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="按状态筛选">
      {options.map(({ value: v, label }) => {
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

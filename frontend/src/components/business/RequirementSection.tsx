import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Accent = "primary" | "success" | "warning";

interface RequirementSectionProps {
  /** 标题左侧语义图标 */
  icon: ReactNode;
  /** 区块主标题（如「主修要求」） */
  title: string;
  /** 标题下方辅助说明（如学年/口径） */
  subtitle?: ReactNode;
  /** 标题栏右侧进度摘要（如「已修 X / 要求 Y 学分」） */
  summary?: ReactNode;
  /** 语义色：决定顶部分隔带与图标颜色，三类各用一色以示区分 */
  accent?: Accent;
  children: ReactNode;
}

const DIVIDER: Record<Accent, string> = {
  primary: "border-t-2 border-primary/30",
  success: "border-t-2 border-success/30",
  warning: "border-t-2 border-warning/30",
};

const ICON_COLOR: Record<Accent, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
};

/**
 * 要求明细页分区卡片容器：明显分隔带 + 语义色标题条 + 进度摘要，
 * 把主修 / 通识核心 / 附加要求三块各自独立成区（shadcn blocks 结构）。
 */
export function RequirementSection({
  icon,
  title,
  subtitle,
  summary,
  accent = "primary",
  children,
}: RequirementSectionProps) {
  return (
    <section className={cn("scroll-mt-24", DIVIDER[accent])}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 pt-5">
        <div className="flex min-w-0 items-start gap-2">
          <span className={cn("mt-0.5 shrink-0", ICON_COLOR[accent])}>{icon}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight tracking-tight">{title}</h3>
            {subtitle != null && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {summary != null && (
          <div className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {summary}
          </div>
        )}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronDown, CheckCircle2 } from "lucide-react";

export interface CollapsibleGroupProps {
  /** 组标题（始终显示） */
  title: React.ReactNode;
  /** 是否已全部修读完成：true 时默认折叠 */
  done: boolean;
  /** 折叠态/标题栏右侧的学分摘要，如「已修 12 / 要求 12 学分」 */
  summary?: React.ReactNode;
  /** 标题栏右侧附加内容（学分 Badge / 页码等），始终可见 */
  headerExtra?: React.ReactNode;
  /** 展开后显示的正文内容 */
  children: React.ReactNode;
  className?: string;
  /** 显式指定初始开合（不传则默认折叠；个别组如需初始展开，调用方传 true） */
  defaultOpen?: boolean;
  /** 组进度百分比（0-100）：在标题栏下方以细条呈现，折叠时也能看到完成度 */
  progress?: number;
}

/**
 * 可折叠要求组容器：默认折叠（defaultOpen 未传时），
 * 不记忆状态——组件因 key 变化（切方案/刷新）重挂载时按默认重新初始化；
 * 个别组如需初始展开，由调用方显式传入 defaultOpen={true} 覆盖。
 */
export function CollapsibleGroup({
  title,
  done,
  summary,
  headerExtra,
  children,
  className,
  defaultOpen,
  progress,
}: CollapsibleGroupProps) {
  const [open, setOpen] = React.useState(() => defaultOpen ?? false);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-4 text-left transition-colors hover:bg-muted/50 sm:px-6"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
              !open && "-rotate-90"
            )}
          />
          <span className="truncate font-semibold leading-none tracking-tight">{title}</span>
          {done && (
            <Badge variant="success" className="shrink-0 gap-1">
              <CheckCircle2 className="h-3 w-3" /> 已完成
            </Badge>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {headerExtra}
          {summary != null && (
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {summary}
            </span>
          )}
        </span>
      </button>

      {/* 组进度细条：折叠时也能扫读完成度 */}
      {typeof progress === "number" && (
        <div
          className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-secondary sm:mx-6"
          role="progressbar"
          aria-label="该组完成度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className={cn(
              "h-full origin-left transition-transform duration-200 ease-out",
              done ? "bg-success" : "bg-chart-1"
            )}
            style={{ transform: `scaleX(${Math.min(100, Math.max(0, progress)) / 100})` }}
          />
        </div>
      )}

      {open && <div className="border-t px-4 pb-5 pt-4 sm:px-6">{children}</div>}
    </Card>
  );
}

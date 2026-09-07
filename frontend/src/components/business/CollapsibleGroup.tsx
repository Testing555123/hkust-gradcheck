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
}

/**
 * 可折叠要求组容器：默认开合由 done 决定（done=true 折叠，否则展开），
 * 不记忆状态——组件因 key 变化（切方案/刷新）重挂载时按 done 重新初始化。
 */
export function CollapsibleGroup({
  title,
  done,
  summary,
  headerExtra,
  children,
  className,
}: CollapsibleGroupProps) {
  const [open, setOpen] = React.useState(!done);

  return (
    <Card className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-6 py-4 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
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
            <span className="text-xs text-muted-foreground tabular-nums">{summary}</span>
          )}
        </span>
      </button>
      {open && <div className="border-t px-6 pb-5 pt-4">{children}</div>}
    </Card>
  );
}

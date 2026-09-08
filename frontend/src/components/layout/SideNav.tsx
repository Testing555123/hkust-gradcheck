import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { useUi, type AppView } from "@/stores/ui";

export interface NavItem {
  key: AppView;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** 右侧计数徽标（如缺口课程数、要求组数） */
  count?: number;
  /** 徽标语义：warning 强调待办，muted 中性信息 */
  countTone?: "warning" | "muted";
}

interface SideNavProps {
  items: NavItem[];
  className?: string;
  /** 点击后回调（小屏抽屉场景用于关闭抽屉） */
  onNavigate?: () => void;
  /** 是否显示「规划中」分组（为后续功能预留位置） */
  showPlanned?: boolean;
  plannedItems?: { label: string }[];
}

/**
 * 侧栏导航：桌面常驻（AppShell 渲染），小屏由抽屉承载。
 * 用 nav + aria-current 表达当前位置；计数徽标直接给出「还差多少」的量化提示。
 */
export function SideNav({
  items,
  className,
  onNavigate,
  showPlanned = true,
  plannedItems = [],
}: SideNavProps) {
  const activeView = useUi((s) => s.activeView);
  const setView = useUi((s) => s.setView);

  return (
    <nav
      aria-label="主导航"
      className={cn("flex h-full flex-col gap-6 overflow-y-auto px-3 py-4", className)}
    >
      <div className="space-y-1">
        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">
          学业进度
        </p>
        {items.map((item) => {
          const active = activeView === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setView(item.key);
                onNavigate?.();
              }}
              className={cn(
                "group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              {/* 当前项左侧指示条 */}
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity duration-150",
                  active ? "opacity-100" : "opacity-0"
                )}
              />
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-primary" : "text-sidebar-muted"
                )}
              />
              <span className="truncate">{item.label}</span>
              {typeof item.count === "number" && item.count > 0 && (
                <span
                  className={cn(
                    "ml-auto rounded-full px-1.5 text-[10px] leading-4 tabular-nums",
                    item.countTone === "warning"
                      ? "bg-warning/15 text-warning"
                      : "bg-surface-2 text-sidebar-muted"
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {showPlanned && plannedItems.length > 0 && (
        <div className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">
            规划中
          </p>
          {plannedItems.map((p) => (
            <div
              key={p.label}
              className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-muted/60"
              title="尚未实现"
            >
              <span className="h-4 w-4 shrink-0 rounded border border-dashed border-sidebar-border" />
              <span className="truncate">{p.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto px-3 pt-4 text-[11px] leading-relaxed text-sidebar-muted">
        勾选记录保存在本机浏览器，不上传服务器。
        <br />
        毕业审核以教务处官方认定为准。
      </div>
    </nav>
  );
}

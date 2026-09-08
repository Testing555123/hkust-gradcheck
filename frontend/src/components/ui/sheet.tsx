import type { ReactNode } from "react";
import { Drawer } from "vaul";

import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * 移动端底部抽屉（基于 vaul）。
 * 用途：小屏替代 Dialog 展示课程详情、导航菜单等内容 —— 弹窗在窄屏会挤压内容，
 * 抽屉从底部升起更符合移动端手势直觉，并自带焦点管理与无障碍语义。
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-overlay/50 backdrop-blur-sm" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[85vh] flex-col rounded-t-2xl border border-border bg-card shadow-pop outline-none",
            className
          )}
        >
          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-surface-3" />
          <div className="shrink-0 px-5 pb-3 pt-4">
            <Drawer.Title className="text-base font-semibold leading-tight">
              {title}
            </Drawer.Title>
            {description && (
              <Drawer.Description className="mt-1 text-xs text-muted-foreground">
                {description}
              </Drawer.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

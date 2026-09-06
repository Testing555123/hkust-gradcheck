import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** 通用空态：图标 + 标题 + 说明 + 可选操作位（从 App.tsx 抽出的 EmptyHint 通用化） */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-8 text-center space-y-2 animate-fade-in-up",
        className
      )}
    >
      {icon}
      <p className="font-medium">{title}</p>
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

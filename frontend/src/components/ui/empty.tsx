import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type EmptyVariant = "default" | "search" | "filter";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** 尺寸：sm 用于列表内嵌空态，md 用于整页空态 */
  size?: "sm" | "md";
  /** 语义变体：为三态提供一致的默认文案语气（图标由调用方决定） */
  variant?: EmptyVariant;
}

const sizeStyles = {
  sm: "p-5 space-y-1.5",
  md: "p-8 space-y-2",
} as const;

/**
 * 通用空态：图标 + 标题 + 说明 + 可选 CTA。
 * 三态统一：无数据 / 无搜索结果 / 无筛选结果，都落在同一组件上，
 * 区别只在于文案与 CTA（清除筛选、运行管线、切换条件）。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = "md",
  variant = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "animate-fade-in-up rounded-lg border bg-card text-center",
        sizeStyles[size],
        variant === "search" && "border-dashed",
        variant === "filter" && "border-dashed bg-muted/30",
        className
      )}
    >
      {icon && <div className={cn(size === "sm" && "scale-90")}>{icon}</div>}
      <p className={cn("font-medium", size === "sm" ? "text-sm" : "text-base")}>{title}</p>
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

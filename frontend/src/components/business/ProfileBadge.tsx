import { Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

interface ProfileBadgeProps {
  year: string;
  code: string;
  onClick: () => void;
  className?: string;
}

/**
 * 顶栏身份摘要：宽屏显示「2026-27 · ECON」，窄屏压缩为「ECON」。
 * 点击可重新打开引导弹窗修改入学信息。
 */
export function ProfileBadge({ year, code, onClick, className }: ProfileBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="修改入学信息"
      aria-label={`修改入学信息，当前为 ${year} ${code}`}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 text-sm text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <Pencil className="h-3.5 w-3.5" />
      <span className="hidden sm:inline text-muted-foreground">{year} · </span>
      <span className="font-medium">{code}</span>
    </button>
  );
}

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  /** 原始错误信息（以次级文本呈现，便于排查） */
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * 统一错误态：图标 + 标题 + 说明 + 重试入口。
 * 刻意不使用大面积破坏性红底 —— 工具型页面应让用户继续操作，而不是制造紧张感。
 */
export function ErrorState({ title, description, error, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center animate-fade-in-up",
        className
      )}
    >
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <div className="space-y-1">
        <p className="font-medium text-destructive">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {error != null && (
          <p className="break-all text-xs text-muted-foreground/80">{String(error)}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </Button>
      )}
    </div>
  );
}

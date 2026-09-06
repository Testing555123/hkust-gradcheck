import { cn } from "@/lib/utils";

/** 列表/页面骨架屏（从 App.tsx 抽出的 Skeleton 通用化） */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4 animate-pulse-soft", className)}>
      <div className="h-40 rounded-lg bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

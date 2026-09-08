import { cn } from "@/lib/utils";

export type SkeletonVariant = "overview" | "courses" | "requirements";

/**
 * 页面骨架屏：与最终布局同构（焦点卡 / 列表行 / 分组卡三种密度），
 * 避免加载完成时发生明显的布局跳动。
 */
export function PageSkeleton({
  variant = "overview",
  className,
}: {
  variant?: SkeletonVariant;
  className?: string;
}) {
  return (
    <div className={cn("animate-pulse-soft space-y-4", className)}>
      {variant === "overview" && (
        <>
          <div className="h-52 rounded-lg bg-muted" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-muted" />
            ))}
          </div>
          <div className="h-64 rounded-lg bg-muted" />
        </>
      )}

      {variant === "courses" && (
        <>
          <div className="h-10 rounded-lg bg-muted" />
          <div className="h-8 w-64 rounded-lg bg-muted" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-muted md:h-14" />
            ))}
          </div>
        </>
      )}

      {variant === "requirements" && (
        <>
          <div className="h-8 w-80 rounded-lg bg-muted" />
          <div className="h-10 rounded-lg bg-muted" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 rounded-lg bg-muted" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

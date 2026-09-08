import { memo } from "react";
import { CheckCircle2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface GroupBarItem {
  key: string;
  name: string;
  /** 已修学分 */
  taken: number;
  /** 含计划的学分 */
  planned: number;
  /** 要求学分（0 表示仅按门数要求） */
  required: number;
  /** 该组课程门数（用于无学分门槛的组说明） */
  courseCount?: number;
  state: "done" | "partial" | "todo";
  /** 未覆盖的课程代码（缺口提示） */
  missingCodes?: string[];
}

interface GroupBarListProps {
  title?: string;
  items: GroupBarItem[];
  emptyHint?: string;
}

const stateText: Record<GroupBarItem["state"], string> = {
  done: "达标",
  partial: "部分完成",
  todo: "未开始",
};

const stateDot: Record<GroupBarItem["state"], string> = {
  done: "bg-success",
  partial: "bg-warning",
  todo: "bg-surface-3",
};

/**
 * 分组完成度占比条（纯 CSS 复刻 Tremor BarList）：
 * 组名 + 右对齐「已修 / 要求」+ 双口径细条（已修实色、计划半透明）+
 * 缺口课程提示。相比原来的等高三列卡片，信息密度更高、更便于纵向扫读。
 * 用 memo 包裹：勾选一门课时只重算受影响的行。
 */
export const GroupBarList = memo(function GroupBarList({
  title,
  items,
  emptyHint,
}: GroupBarListProps) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          {emptyHint ?? "暂无要求分组"}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        {title && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{title}</p>
            <span className="text-xs text-muted-foreground tabular-nums">
              {items.filter((i) => i.state === "done").length}/{items.length} 组达标
            </span>
          </div>
        )}
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const total = item.required;
            const takenPct = total ? Math.min(100, (item.taken / total) * 100) : 0;
            const plannedPct = total ? Math.min(100, (item.planned / total) * 100) : 0;
            const extraPct = Math.max(0, plannedPct - takenPct);

            return (
              <li key={item.key} className="py-3 first:pt-1 last:pb-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateDot[item.state])}
                    />
                    <span className="truncate text-sm font-medium">{item.name}</span>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-2 text-xs">
                    <span className="font-medium tabular-nums">
                      {item.taken}
                      <span className="text-muted-foreground">/{total}</span>
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[10px] leading-4",
                        item.state === "done"
                          ? "bg-success/12 text-success"
                          : item.state === "partial"
                            ? "bg-warning/15 text-warning"
                            : "bg-surface-2 text-muted-foreground"
                      )}
                    >
                      {stateText[item.state]}
                    </span>
                  </div>
                </div>

                <div
                  className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label={`${item.name} 完成度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(plannedPct)}
                >
                  <div
                    className="absolute inset-0 origin-left bg-planned/50 transition-transform duration-200 ease-out"
                    style={{ transform: `scaleX(${(takenPct + extraPct) / 100})` }}
                  />
                  <div
                    className={cn(
                      "absolute inset-0 origin-left transition-transform duration-200 ease-out",
                      item.state === "done" ? "bg-success" : "bg-chart-1"
                    )}
                    style={{ transform: `scaleX(${takenPct / 100})` }}
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {total > 0 ? (
                    <span className="tabular-nums">
                      已修 {item.taken} · 含计划 {item.planned} · 要求 {total} 学分
                    </span>
                  ) : (
                    <span className="tabular-nums">共 {item.courseCount ?? 0} 门课（无学分门槛）</span>
                  )}
                  {item.missingCodes && item.missingCodes.length > 0 && (
                    <span className="flex items-center gap-1 text-warning">
                      尚缺 {item.missingCodes.length} 门：
                      <span className="font-mono">
                        {item.missingCodes.slice(0, 3).join("、")}
                      </span>
                      {item.missingCodes.length > 3 && " 等"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {items.every((i) => i.state === "done") && (
          <p className="flex items-center gap-1.5 pt-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            全部要求组均已达标
          </p>
        )}
      </CardContent>
    </Card>
  );
});

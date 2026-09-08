import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";

import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ProgressHeroProps {
  title: string;
  subtitle: string;
  /** 计划后仍缺的学分（0 表示已覆盖） */
  remaining: number;
  totalRequired: number;
  takenTotal: number;
  plannedTotal: number;
  percentTaken: number;
  percentPlanned: number;
  /** 口径拆解说明（主修 / 通识 / 附加要求分别多少） */
  breakdown?: ReactNode;
  action?: ReactNode;
}

/**
 * 总览页焦点：只回答一个问题 —— 「我还差多少」。
 * 单个巨型数字 + 一条双口径分段进度条（已修实色 / 计划半透明），
 * 其余数据全部降级为次级文本，避免与下方卡片争夺注意力。
 */
export function ProgressHero({
  title,
  subtitle,
  remaining,
  totalRequired,
  takenTotal,
  plannedTotal,
  percentTaken,
  percentPlanned,
  breakdown,
  action,
}: ProgressHeroProps) {
  const covered = remaining <= 0;
  // 分段：已修段 + 计划增量段（不超过 100%）
  const takenPct = Math.min(100, Math.max(0, percentTaken));
  const extraPct = Math.min(100 - takenPct, Math.max(0, percentPlanned - percentTaken));

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-card to-accent shadow-pop">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <GraduationCap className="h-5 w-5 shrink-0 text-primary" />
              <span className="truncate">{title}</span>
            </CardTitle>
            <CardDescription className="mt-1">{subtitle}</CardDescription>
          </div>
          {action}
        </div>

        {/* 焦点：单一大数字 */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex items-end gap-2">
            <span
              className={cn(
                "text-5xl font-semibold leading-none tabular-nums sm:text-6xl",
                covered ? "text-success" : "text-warning"
              )}
            >
              {remaining}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">
              学分缺口
              <span className="hidden sm:inline">
                {covered ? " · 已覆盖" : "（按当前计划）"}
              </span>
            </span>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-semibold leading-none text-primary tabular-nums sm:text-4xl">
              {percentPlanned}%
            </span>
            <span className="pb-1 text-sm text-muted-foreground">毕业进度（含计划）</span>
          </div>
        </div>

        {/* 双口径分段进度条：已修实色 + 计划增量半透明，只动 transform */}
        <div className="space-y-2">
          <div
            className="relative h-3 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="毕业学分进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentPlanned}
            aria-valuetext={`已修 ${takenTotal} 学分，含计划 ${plannedTotal} 学分，要求 ${totalRequired} 学分`}
          >
            {/* 计划段（含已修）在下层，已修段覆盖其上；均用 scaleX 动画，只动 transform */}
            <div
              className="absolute inset-0 origin-left bg-planned/50 transition-transform duration-200 ease-out"
              style={{ transform: `scaleX(${(takenPct + extraPct) / 100})` }}
            />
            <div
              className="absolute inset-0 origin-left bg-success transition-transform duration-200 ease-out"
              style={{ transform: `scaleX(${takenPct / 100})` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" />
              已修 {takenTotal} 学分（{percentTaken}%）
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-planned/50" />
              含计划 {plannedTotal} 学分（{percentPlanned}%）
            </span>
            <span className="tabular-nums">要求 {totalRequired} 学分</span>
          </div>
        </div>

        {breakdown && (
          <p className="text-xs leading-relaxed text-muted-foreground">{breakdown}</p>
        )}
      </CardContent>
    </Card>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2 } from "lucide-react";

import type { CommonCoreBucket, CommonCoreGroup } from "@/lib/common-core";
import { CC_AREA_NAMES, CC_GROUP_NAMES } from "@/lib/common-core";

interface CCProgressCardProps {
  group: CommonCoreGroup;
  required: number;
  taken: number;
  completed: number;
}

/** 通识核心组卡：组级进度 + 各 Area 分桶明细（含替代说明） */
export function CCProgressCard({ group, required, taken, completed }: CCProgressCardProps) {
  const isDone = required > 0 && completed >= required;
  const percentTaken = required ? Math.min(100, Math.round((taken / required) * 100)) : 0;
  const percentPlanned = required ? Math.min(100, Math.round((completed / required) * 100)) : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              通识核心 · {CC_GROUP_NAMES[group.name] ?? group.name}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">要求 {required} 学分</p>
          </div>
          {isDone ? (
            <Badge variant="success" className="gap-1 shrink-0">
              <CheckCircle2 className="h-3 w-3" /> 达标
            </Badge>
          ) : (
            <Badge variant="warning" className="shrink-0">
              尚缺 {Math.max(0, required - completed)}
            </Badge>
          )}
        </div>

        <BucketBar label="已修" caption={`${taken} / ${required}`} value={percentTaken} />
        <BucketBar label="含计划" caption={`${completed} / ${required}`} value={percentPlanned} />

        <div className="space-y-1 pt-1 border-t border-dashed">
          {group.buckets.map((b) => (
            <CCBucketRow key={b.label} bucket={b} />
          ))}
        </div>

        {group.note && (
          <p className="text-[11px] leading-snug text-muted-foreground pt-1">{group.note}</p>
        )}
      </CardContent>
    </Card>
  );
}

function BucketBar({ label, caption, value }: { label: string; caption: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{caption}</span>
      </div>
      <Progress value={value} indicatorClassName="animate-progress-grow" />
    </div>
  );
}

/** 通识 Area 分桶行（进度 + 学分 + 可替代标记），供明细页复用 */
export function CCBucketRow({ bucket: b }: { bucket: CommonCoreBucket }) {
  const done = b.completedCredits >= b.required;
  const width = b.required ? Math.min(100, (b.completedCredits / b.required) * 100) : 0;
  const fullName = CC_AREA_NAMES[b.label] ?? b.fullName;
  const tip = b.note ? `${fullName}（${b.note}）` : fullName;
  return (
    <div className="flex items-center gap-2 text-xs" title={tip}>
      <span
        className={
          "w-14 shrink-0 truncate font-medium " +
          (b.isElective ? "text-muted-foreground" : "text-foreground")
        }
      >
        {b.label}
        {b.isElective && "*"}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={
            "h-full rounded-full transition-all duration-500 " +
            (done ? "bg-success" : b.completedCredits > 0 ? "bg-primary/60" : "bg-transparent")
          }
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {b.completedCredits}/{b.required}
      </span>
      {b.isElective && <span className="shrink-0 text-[10px] text-muted-foreground">可替代</span>}
    </div>
  );
}

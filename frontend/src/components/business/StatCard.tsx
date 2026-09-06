import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type StatTone = "primary" | "success" | "warning" | "destructive";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone: StatTone;
  hint?: string;
}

const toneStyles: Record<StatTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/10 text-destructive",
};

/** shadcn dashboard 式统计卡：图标语义色底 + 数值 + 描述行 */
export function StatCard({ label, value, icon: Icon, tone, hint }: StatCardProps) {
  return (
    <Card className="hover:shadow-md">
      <CardContent className="flex items-start gap-3 p-4">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            toneStyles[tone]
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

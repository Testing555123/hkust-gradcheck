import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleGroup } from "@/components/business/CollapsibleGroup";
import { Shapes } from "lucide-react";
import { computeCommonCoreAudit } from "@/lib/common-core";
import { useSelection } from "@/stores/selection";
import { useProfile } from "@/stores/profile";
import { CCBucketBlock } from "@/components/business/CommonCoreCourses";
import type { ProgramTreeData } from "@/types";

const GROUP_NAMES: Record<string, string> = {
  Foundations: "基础",
  Broadening: "拓展",
  Experiencing: "体验",
};

/** 要求明细页的通识核心区块：三组 + 各 Area 分桶（与主修要求树并列） */
export function CommonCoreSection({ tree }: { tree: ProgramTreeData }) {
  const status = useSelection((s) => s.status);
  const profile = useProfile((s) => s.profile);
  const cc = useMemo(
    () =>
      computeCommonCoreAudit({
        courses: Object.entries(status).map(([code, s]) => ({ code, status: s })),
        program: tree.program.code,
        school: profile?.school ?? null,
        admissionYear: profile?.admissionYear ?? null,
      }),
    [status, tree.program.code, profile?.school, profile?.admissionYear]
  );

  // 入学学年不设桶的 Area（Q6b）：课程仍列出并标注说明
  const notApplicableAreas = useMemo(() => {
    const areas: string[] = [];
    if (!cc.framework.susApplicable) areas.push("SUS");
    if (!cc.framework.haicApplicable) areas.push("HAIC");
    return areas;
  }, [cc.framework.susApplicable, cc.framework.haicApplicable]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Shapes className="h-4 w-4" />
        <span>通识核心 Common Core（30 学分框架）</span>
        <Badge variant="outline" className="font-normal">
          {cc.framework.susApplicable ? "2025-26 起含 SUS" : "2022-23 起框架"}
        </Badge>
        {cc.framework.haicApplicable && (
          <Badge variant="outline" className="font-normal">
            2026-27 起含 HAIC
          </Badge>
        )}
      </div>

      {cc.groups.map((g) => {
        const required = g.buckets.reduce((s, b) => s + b.required, 0);
        const completed = g.buckets.reduce((s, b) => s + b.completedCredits, 0);
        const allMet = g.buckets.every((b) => b.completedCredits >= b.required);
        const done = allMet && required > 0;
        return (
          <CollapsibleGroup
            key={`${tree.program.code}-${g.name}`}
            title={
              <span>
                通识核心 · {GROUP_NAMES[g.name] ?? g.name}（{g.name}）
              </span>
            }
            done={done}
            summary={`已计 ${completed} / 要求 ${required} 学分`}
            headerExtra={
              <Badge variant="outline" className="shrink-0 tabular-nums">
                {required} credits
              </Badge>
            }
          >
            <div className="space-y-4">
              {g.note && (
                <div className="rounded-md border-l-4 border-primary/40 bg-muted/60 px-3 py-2">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground/80">说明：</span>
                    {g.note}
                  </p>
                </div>
              )}
              {g.buckets.map((b) => (
                <CCBucketBlock key={b.label} bucket={b} notApplicableAreas={notApplicableAreas} />
              ))}
            </div>
          </CollapsibleGroup>
        );
      })}

      {cc.unmatched.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <Shapes className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {cc.unmatched.length} 门课程未匹配到通识 Area（不在官方课程清单内），不计入通识核心进度：
            {cc.unmatched.map((u) => u.code).join("、")}
          </span>
        </div>
      )}
    </div>
  );
}

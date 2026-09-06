import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CourseRow } from "@/components/business/CourseRow";
import { useSelection } from "@/stores/selection";
import { CheckCircle2, FileText, Info, StickyNote } from "lucide-react";
import type { CourseRef, ProgramTreeData } from "@/types";

/** 按课程行渲染一批课程（去重） */
function CourseRows({ courses }: { courses: CourseRef[] }) {
  const seen = new Set<string>();
  const unique = courses.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
  return (
    <div className="space-y-2">
      {unique.map((c) => (
        <CourseRow key={c.code} course={c} />
      ))}
    </div>
  );
}

/** Electives 组：按 Area 分块渲染（同课多 Area 会在多块出现），未分类归入独立块 */
function AreaBlocks({ courses }: { courses: CourseRef[] }) {
  const areaMap = new Map<string, CourseRef[]>();
  const unclassified: CourseRef[] = [];
  for (const c of courses) {
    if (c.areas && c.areas.length > 0) {
      for (const a of c.areas) {
        areaMap.set(a, [...(areaMap.get(a) ?? []), c]);
      }
    } else {
      unclassified.push(c);
    }
  }

  return (
    <div className="space-y-4">
      {[...areaMap.entries()].map(([area, cs]) => (
        <div key={area}>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="text-primary border-primary/40">
              {area}
            </Badge>
            <span className="text-xs text-muted-foreground">{new Set(cs.map((c) => c.code)).size} 门</span>
          </div>
          <CourseRows courses={cs} />
        </div>
      ))}
      {unclassified.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">Courses Without Associated Area</Badge>
            <span className="text-xs text-muted-foreground">{unclassified.length} 门</span>
          </div>
          <CourseRows courses={unclassified} />
        </div>
      )}
    </div>
  );
}

/** 毕业要求明细树：按组展示课程清单、学分要求、Note 说明与 Area 分类 */
export function RequirementTree({ tree }: { tree: ProgramTreeData }) {
  const status = useSelection((s) => s.status);

  return (
    <div className="space-y-4">
      {tree.groups.map((g) => {
        const takenCount = g.courses.filter((c) => status[c.code] === "taken").length;
        const plannedCount = g.courses.filter((c) => status[c.code] === "planned").length;
        const hasAreas = g.courses.some((c) => c.areas && c.areas.length > 0);

        return (
          <Card key={g.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="truncate">{g.name}</span>
                    {takenCount > 0 && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
                  </CardTitle>
                  <CardDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      要求 <strong className="text-foreground">{g.required_credits}</strong> 学分
                    </span>
                    <span>共 {g.courses.length} 门课</span>
                    {takenCount > 0 && <span className="text-success">已修 {takenCount}</span>}
                    {plannedCount > 0 && <span className="text-primary">计划 {plannedCount}</span>}
                    {g.source_ref && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <FileText className="h-3 w-3" /> {g.source_ref}
                      </span>
                    )}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {g.required_credits} credits
                </Badge>
              </div>
              {g.min_courses != null && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" /> 至少修读 {g.min_courses} 门
                </p>
              )}
              {/* 官方 Note 说明（来自 PDF 原文） */}
              {g.note && (
                <div className="mt-2 rounded-md border-l-4 border-primary/40 bg-muted/60 px-3 py-2">
                  <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                    <StickyNote className="mr-1.5 inline h-3.5 w-3.5 align-[-2px] text-primary/70" />
                    <span className="font-medium text-foreground/80">官方说明：</span>
                    {g.note}
                  </p>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {g.courses.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">
                  该组未列出具体课程（请参考上方官方说明的选课规则）
                </p>
              )}
              {hasAreas ? (
                <AreaBlocks courses={g.courses} />
              ) : (
                g.courses.map((c) => <CourseRow key={`${g.id}-${c.code}`} course={c} />)
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

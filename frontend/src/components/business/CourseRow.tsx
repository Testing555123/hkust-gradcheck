import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useSelection } from "@/stores/selection";
import { cn } from "@/lib/utils";
import type { CourseRef } from "@/types";

interface CourseRowProps {
  course: CourseRef;
  groupName?: string;
  sourceRef?: string | null;
}

/** 单行课程：已修（绿勾）/ 计划（蓝标）互斥勾选，勾选即时联动进度 */
export function CourseRow({ course, groupName, sourceRef }: CourseRowProps) {
  const current = useSelection((s) => s.status[course.code]);
  const toggle = useSelection((s) => s.toggle);

  const isTaken = current === "taken";
  const isPlanned = current === "planned";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-all hover:shadow-sm hover:border-primary/40",
        isTaken && "bg-success/5 border-success/30",
        isPlanned && "bg-primary/5 border-primary/30"
      )}
    >
      {/* 已修 */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0" title="标记为已修读">
        <Checkbox
          checked={isTaken}
          onCheckedChange={() => toggle(course.code, "taken")}
          className={cn(isTaken && "bg-success border-success")}
        />
        <span className={cn("text-xs", isTaken ? "text-success font-medium" : "text-muted-foreground")}>
          已修
        </span>
      </label>

      {/* 计划 */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0" title="加入修读计划">
        <Checkbox checked={isPlanned} onCheckedChange={() => toggle(course.code, "planned")} />
        <span className={cn("text-xs", isPlanned ? "text-primary font-medium" : "text-muted-foreground")}>
          计划
        </span>
      </label>

      <div className="min-w-0 flex-1">
        {/* 已修划线：background-size 0→100% 过渡（200ms），替代瞬间 line-through */}
        <p
          className={cn(
            "text-sm font-medium truncate bg-gradient-to-r from-current to-current bg-no-repeat bg-left-bottom bg-[length:0%_1px] pb-0.5 transition-[background-size] duration-200 ease-out",
            isTaken && "bg-[length:100%_1px] opacity-60"
          )}
        >
          <span className="font-mono text-xs text-muted-foreground mr-2">{course.code}</span>
          {course.name}
        </p>
        {groupName && <p className="text-xs text-muted-foreground mt-0.5 truncate">{groupName}</p>}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {course.areas && course.areas.length > 0 && (
          <Badge
            variant="outline"
            className="hidden md:inline-flex max-w-[200px] truncate text-[10px] text-primary border-primary/30"
            title={course.areas.join(" / ")}
          >
            {course.areas.join(" / ")}
          </Badge>
        )}
        {sourceRef && (
          <Badge variant="outline" className="hidden sm:inline-flex font-mono text-[10px] text-muted-foreground">
            {sourceRef}
          </Badge>
        )}
        <Badge variant="secondary" className="tabular-nums">
          {course.credits} 学分
        </Badge>
      </div>
    </div>
  );
}

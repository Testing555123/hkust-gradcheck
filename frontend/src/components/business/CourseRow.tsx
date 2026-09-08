import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSelection } from "@/stores/selection";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";
import type { CourseRef } from "@/types";

interface CourseRowProps {
  course: CourseRef;
  groupName?: string;
  sourceRef?: string | null;
}

/**
 * 课程行：已修（绿）/ 计划（蓝）互斥勾选，勾选即时联动进度。
 *
 * 双形态：
 * - 桌面（md+）：单行表格密度，勾选为内联小控件
 * - 移动（<md）：卡片流，课号课名置顶、勾选为两块等宽大按钮（点击区 ≥44px）
 */
export function CourseRow({ course, groupName, sourceRef }: CourseRowProps) {
  const current = useSelection((s) => s.status[course.code]);
  const toggle = useSelection((s) => s.toggle);
  const openCourse = useUi((s) => s.openCourse);

  const isTaken = current === "taken";
  const isPlanned = current === "planned";

  const chipBase =
    "flex min-h-[44px] flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-md border text-xs transition-colors " +
    "md:min-h-0 md:flex-none md:justify-start md:border-0 md:bg-transparent md:p-0";

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border bg-card p-3 transition-all hover:border-primary/40 hover:shadow-sm md:flex-row md:items-center md:gap-3 md:py-2.5",
        isTaken && "border-success/30 bg-success/5",
        isPlanned && "border-primary/30 bg-primary/5"
      )}
    >
      {/* 勾选区：移动端为两块大按钮，桌面通过 md:contents 还原为内联排列 */}
      <div className="flex gap-2 md:contents">
        <label
          className={cn(
            chipBase,
            "border-border bg-surface-2 md:bg-transparent",
            isTaken && "border-success/40 bg-success/10 text-success md:bg-transparent"
          )}
          title="标记为已修读"
        >
          <Checkbox
            checked={isTaken}
            onCheckedChange={() => toggle(course.code, "taken")}
            className={cn(isTaken && "border-success bg-success")}
          />
          <span className={cn(isTaken ? "font-medium text-success" : "text-muted-foreground")}>
            已修
          </span>
        </label>

        <label
          className={cn(
            chipBase,
            "border-border bg-surface-2 md:bg-transparent",
            isPlanned && "border-primary/40 bg-primary/10 text-primary md:bg-transparent"
          )}
          title="加入修读计划"
        >
          <Checkbox checked={isPlanned} onCheckedChange={() => toggle(course.code, "planned")} />
          <span className={cn(isPlanned ? "font-medium text-primary" : "text-muted-foreground")}>
            计划
          </span>
        </label>
      </div>

      {/* 课程信息（移动端置顶） */}
      <div className="order-first min-w-0 flex-1 md:order-none">
        {/* 已修划线：background-size 0→100% 过渡（200ms），替代瞬间 line-through */}
        <p
          className={cn(
            "truncate bg-gradient-to-r from-current to-current bg-left-bottom bg-no-repeat bg-[length:0%_1px] pb-0.5 text-sm font-medium transition-[background-size] duration-200 ease-out",
            isTaken && "bg-[length:100%_1px] opacity-60"
          )}
        >
          <span className="mr-2 font-mono text-xs text-muted-foreground">{course.code}</span>
          {course.name}
        </p>
        {groupName && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{groupName}</p>
        )}
      </div>

      {/* 元信息：学分 / Area / 页码 / 详情入口 */}
      <div className="flex shrink-0 items-center gap-1.5">
        {course.areas && course.areas.length > 0 && (
          <Badge
            variant="outline"
            className="hidden max-w-[200px] truncate border-primary/30 text-[10px] text-primary md:inline-flex"
            title={course.areas.join(" / ")}
          >
            {course.areas.join(" / ")}
          </Badge>
        )}
        {sourceRef && (
          <Badge
            variant="outline"
            className="hidden font-mono text-[10px] text-muted-foreground sm:inline-flex"
          >
            {sourceRef}
          </Badge>
        )}
        <Badge variant="secondary" className="tabular-nums">
          {course.credits} 学分
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground md:h-6 md:w-6"
          aria-label={`查看 ${course.code} 课程详情`}
          data-testid="course-info"
          onClick={() => openCourse(course.code)}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

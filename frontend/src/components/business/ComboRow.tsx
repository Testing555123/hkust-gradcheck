import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { comboActiveCodes, comboCredits, isComboComplete } from "@/lib/combos";
import { useSelection } from "@/stores/selection";
import { useUi } from "@/stores/ui";
import { cn } from "@/lib/utils";
import type { ComboGroup, ComboOption } from "@/types";

interface ComboRowProps {
  combo: ComboGroup;
  /** 该组合所属分支不是当前已选方向时传入分支名：整行降透明度 */
  offBranch?: string | null;
  /** 页码出处（同组的 source_ref），桌面端显示 */
  sourceRef?: string | null;
}

/** 行内元素：一门可勾选的课，或一个结构分隔符（/ + OR） */
type RowItem =
  | { type: "course"; course: ComboOption }
  | { type: "sep"; label: string };

/**
 * 把组合摊平成「课程 + 分隔符」序列：
 * part 内备选用 `/`、part 之间（AND）用 `+`、互斥选项之间用 `OR`。
 * 例：`MATH1013 / MATH1023 + MATH1014 / MATH1024  OR  MATH1020`
 */
function flatten(combo: ComboGroup): RowItem[] {
  const items: RowItem[] = [];

  const emitPart = (part: { courses: ComboOption[] }, first: boolean) => {
    if (!first) items.push({ type: "sep", label: "+" });
    part.courses.forEach((course, i) => {
      if (i > 0) items.push({ type: "sep", label: "/" });
      items.push({ type: "course", course });
    });
  };

  if (combo.kind === "and") {
    combo.parts.forEach((part, i) => emitPart(part, i === 0));
    return items;
  }

  combo.options.forEach((option, i) => {
    if (i > 0) items.push({ type: "sep", label: "OR" });
    option.parts.forEach((part, j) => emitPart(part, j === 0));
  });
  return items;
}

/**
 * 组合行：官方 Note 里的互斥组合 / 捆绑（二选一、A AND B、(A AND B) OR C）。
 *
 * 与 CourseRow 视觉同构（同一卡片、hover 微动效、已修 success / 计划 primary 配色），
 * 差异在于：课程之间以 `/` `+` `OR` 表达官方组合结构，整组只按一个选项计入学分
 * （口径见 lib/combos.ts）。
 */
export function ComboRow({ combo, offBranch = null, sourceRef = null }: ComboRowProps) {
  const status = useSelection((s) => s.status);
  const credits = comboCredits(combo, status);
  const complete = isComboComplete(combo, status);
  const active = comboActiveCodes(combo, status);
  const items = flatten(combo);

  const optionCount = combo.kind === "or" ? combo.options.length : 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-all hover:border-primary/40 hover:shadow-sm",
        complete ? "border-success/30 bg-success/[0.04]" : "border-primary/25 bg-card",
        offBranch && "opacity-60"
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-[10px]",
            complete ? "border-success/40 text-success" : "border-primary/40 text-primary"
          )}
        >
          {combo.kind === "and" ? "须全修" : optionCount > 2 ? `${optionCount} 选一` : "二选一"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {combo.kind === "and" ? "各门都要修读" : "任选其一，按一个选项计入学分"}
        </span>
        {sourceRef && (
          <Badge
            variant="outline"
            className="hidden font-mono text-[10px] text-muted-foreground sm:inline-flex"
          >
            {sourceRef}
          </Badge>
        )}
        <Badge
          variant="secondary"
          className="ml-auto shrink-0 tabular-nums"
          title="未选择时按各选项的最高学分预估；部分完成的捆绑不计学分"
        >
          计 {credits} 学分
        </Badge>
      </div>

      <div className="space-y-2">
        {items.map((item, index) =>
          item.type === "sep" ? (
            <Separator key={`sep-${index}`} label={item.label} />
          ) : (
            <ComboOptionRow
              key={item.course.code}
              option={item.course}
              isActive={active.has(item.course.code)}
            />
          )
        )}
        {combo.unresolved?.map((code) => (
          <div
            key={code}
            className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5"
          >
            <span className="font-mono text-xs text-muted-foreground">{code}</span>
            <span className="text-[10px] text-muted-foreground">课程库未收录，不可勾选</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 结构分隔符：/ 表示二选一的备选，+ 表示都要，OR 表示互斥选项 */
function Separator({ label }: { label: string }) {
  const strong = label === "OR";
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        className={cn(
          "text-[10px] font-semibold tracking-wider",
          strong ? "text-primary/70" : "text-muted-foreground/70"
        )}
      >
        {label}
      </span>
      <span className={cn("h-px flex-1", strong ? "bg-primary/20" : "bg-border/60")} />
    </div>
  );
}

/** 组合内的单个备选：与 CourseRow 同样的桌面内联 / 移动大按钮双形态 */
function ComboOptionRow({
  option,
  isActive,
}: {
  option: ComboOption;
  /** 是否为当前计入该组合的课（未选时为组内学分最高的一门） */
  isActive: boolean;
}) {
  const current = useSelection((s) => s.status[option.code]);
  const toggle = useSelection((s) => s.toggle);
  const openCourse = useUi((s) => s.openCourse);

  const isTaken = current === "taken";
  const isPlanned = current === "planned";
  const selected = isTaken || isPlanned;

  const chipBase =
    "flex min-h-[44px] flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-md border text-xs transition-colors " +
    "md:min-h-0 md:flex-none md:justify-start md:border-0 md:bg-transparent md:p-0";

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border bg-card p-3 transition-all md:flex-row md:items-center md:gap-3 md:border-0 md:bg-transparent md:p-0",
        "hover:border-primary/40",
        isTaken && "border-success/30 bg-success/5 md:bg-transparent",
        isPlanned && "border-primary/30 bg-primary/5 md:bg-transparent",
        // 非当前计入的备选项弱化，直观表达互斥关系
        !selected && !isActive && "opacity-70"
      )}
    >
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
            onCheckedChange={() => toggle(option.code, "taken")}
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
          <Checkbox
            checked={isPlanned}
            onCheckedChange={() => toggle(option.code, "planned")}
          />
          <span className={cn(isPlanned ? "font-medium text-primary" : "text-muted-foreground")}>
            计划
          </span>
        </label>
      </div>

      <div className="order-first min-w-0 flex-1 md:order-none">
        <p
          className={cn(
            "truncate bg-gradient-to-r from-current to-current bg-left-bottom bg-no-repeat bg-[length:0%_1px] pb-0.5 text-sm font-medium transition-[background-size] duration-200 ease-out",
            isTaken && "bg-[length:100%_1px] opacity-60"
          )}
        >
          <span className="mr-2 font-mono text-xs text-muted-foreground">{option.code}</span>
          {option.name}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant="secondary" className="tabular-nums">
          {option.credits} 学分
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground md:h-6 md:w-6"
          aria-label={`查看 ${option.code} 课程详情`}
          onClick={() => openCourse(option.code)}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

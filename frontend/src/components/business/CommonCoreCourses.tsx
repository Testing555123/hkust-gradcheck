import { useMemo, useState } from "react";
import { ChevronDown, ListChecks, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CourseRow } from "@/components/business/CourseRow";
import { CCBucketRow } from "@/components/business/CCProgressCard";
import {
  CC_GROUP_NAMES,
  coursesForArea,
  coursesForElectiveSlot,
  type CommonCoreBucket,
  type CommonCoreCourseInfo,
  type CommonCoreGroup,
} from "@/lib/common-core";
import { cn } from "@/lib/utils";

/** 桶 → 候选课程：选修槽（CTDL / UxOP）展示全量，普通桶按 Area 派生，ANY 桶无固定清单 */
export function candidatesForBucket(label: string): CommonCoreCourseInfo[] {
  if (label === "CTDL" || label === "UxOP") return coursesForElectiveSlot();
  if (label === "ANY") return [];
  return coursesForArea(label);
}

/** 「当前计入」chips：引擎贪心分配的实际结果 + 选修槽替代学分 */
export function CCCountedChips({ bucket }: { bucket: CommonCoreBucket }) {
  const counted = bucket.counted ?? [];
  const substituted = bucket.substitutedCredits ?? 0;
  if (counted.length === 0 && substituted <= 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-16 pt-0.5">
      <span className="text-[10px] text-muted-foreground shrink-0">已计</span>
      {counted.map((c) => (
        <Badge
          key={c.code}
          variant="outline"
          className="font-mono text-[10px] font-normal text-success border-success/40"
          title={`${c.code} · ${c.credits} 学分计入 ${bucket.label}`}
        >
          {c.code}
          <span className="ml-1 text-muted-foreground tabular-nums">{c.credits}</span>
        </Badge>
      ))}
      {substituted > 0 && (
        <Badge
          variant="outline"
          className="text-[10px] font-normal text-primary border-primary/40"
          title="由其他通识桶的未占用学分替代计入，无法归属到具体课程"
        >
          替代 +{substituted}
        </Badge>
      )}
    </div>
  );
}

interface CCPickerProps {
  candidates: CommonCoreCourseInfo[];
  /** 默认是否展开（选修槽全量列表应默认折叠） */
  defaultOpen?: boolean;
  /** 入学学年不设桶的 Area（如未达 SUS/HAIC 适用年），命中课程标注说明 */
  notApplicableAreas?: string[];
}

/** 可折叠候选课程列表（>12 门时显示搜索框；多 Area 课程标注「计入以引擎为准」） */
export function CCoursePicker({ candidates, defaultOpen = true, notApplicableAreas = [] }: CCPickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [keyword, setKeyword] = useState("");

  const searchable = candidates.length > 12;
  const filtered = useMemo(() => {
    if (!keyword.trim()) return candidates;
    const kw = keyword.trim().toLowerCase();
    return candidates.filter(
      (c) => c.code.toLowerCase().includes(kw) || c.name.toLowerCase().includes(kw)
    );
  }, [candidates, keyword]);

  const hasMultiArea = candidates.some((c) => c.areas.length > 1);
  const isNotApplicable = (c: CommonCoreCourseInfo) =>
    notApplicableAreas.length > 0 && c.areas.length > 0 && c.areas.every((a) => notApplicableAreas.includes(a));

  return (
    <div className="rounded-md border border-dashed bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" />
          候选课程（{candidates.length} 门）—— 勾选即计入上方进度
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-dashed px-3 py-2.5">
          {searchable && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索课号 / 课程名…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}
          <div className="space-y-1.5">
            {filtered.map((c) => (
              <div key={c.code}>
                <CourseRow course={{ code: c.code, name: c.name, credits: c.credits, areas: c.areas }} />
                {isNotApplicable(c) && (
                  <p className="pl-3 pt-0.5 text-[10px] text-warning">
                    你的入学学年不设 {c.areas.join(" / ")} 桶，该课不计入对应进度（仍可选修）
                  </p>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                没有匹配「{keyword.trim()}」的课程
              </p>
            )}
          </div>
          {hasMultiArea && (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              多 Area 课程会出现在多个桶的候选列表中，实际计入哪个桶以引擎分配（上方「已计」）为准。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** 单个桶 = 进度行 + 计入 chips + 候选课程 */
export function CCBucketBlock({
  bucket,
  notApplicableAreas,
}: {
  bucket: CommonCoreBucket;
  notApplicableAreas?: string[];
}) {
  const candidates = useMemo(() => candidatesForBucket(bucket.label), [bucket.label]);
  return (
    <div className="space-y-1.5">
      <CCBucketRow bucket={bucket} />
      <CCCountedChips bucket={bucket} />
      {candidates.length > 0 && (
        <CCoursePicker
          candidates={candidates}
          defaultOpen={!bucket.isElective}
          notApplicableAreas={notApplicableAreas}
        />
      )}
    </div>
  );
}

/** 课程选择页用：组级折叠面板（默认展开），内含各桶 */
export function CCGroupPanel({ group, notApplicableAreas = [] }: { group: CommonCoreGroup; notApplicableAreas?: string[] }) {
  const [open, setOpen] = useState(true);
  const required = group.buckets.reduce((s, b) => s + b.required, 0);
  const completed = group.buckets.reduce((s, b) => s + b.completedCredits, 0);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold truncate">
            通识核心 · {CC_GROUP_NAMES[group.name] ?? group.name}
          </span>
          <Badge variant="outline" className="shrink-0 tabular-nums font-normal">
            {completed}/{required} 学分
          </Badge>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t px-4 py-3">
          {group.buckets.map((b) => (
            <CCBucketBlock key={b.label} bucket={b} notApplicableAreas={notApplicableAreas} />
          ))}
          {group.note && <p className="text-[11px] leading-snug text-muted-foreground">{group.note}</p>}
        </div>
      )}
    </div>
  );
}

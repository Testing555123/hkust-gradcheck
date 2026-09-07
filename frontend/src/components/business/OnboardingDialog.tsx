import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, FileUp, GraduationCap, School, Search, Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { codesOf, yearsOf } from "@/lib/profile";
import { resolveAttachedPrograms, selectableAttached } from "@/lib/attached";
import { schoolOf } from "@/lib/common-core";
import { cn } from "@/lib/utils";
import type { ProgramInfo } from "@/types";

const SCHOOL_CN: Record<string, string> = {
  SSCI: "理学院",
  SENG: "工程学院",
  SBM: "商学院",
  SHSS: "人文社会科学学院",
  AIS: "跨学科学院",
};

interface OnboardingDialogProps {
  open: boolean;
  programs: ProgramInfo[];
  /** 无 profile 或 profile 失效时为 true：禁止 ESC / 点遮罩关闭，且不提供取消 */
  forced: boolean;
  initialYear?: string;
  initialCode?: string;
  /** 已保存的辅修 / EXTM 多选（回填用） */
  initialMinors?: string[];
  onSubmit: (sel: { year: string; code: string; minors: string[] }) => void;
  /** 仅 forced=false 时生效（用户主动点击取消） */
  onCancel?: () => void;
  /** 打开成绩单导入弹窗（替代手动选择） */
  onImportTranscript?: () => void;
}

export function OnboardingDialog({
  open,
  programs,
  forced,
  initialYear,
  initialCode,
  initialMinors,
  onSubmit,
  onCancel,
  onImportTranscript,
}: OnboardingDialogProps) {
  const years = useMemo(() => yearsOf(programs), [programs]);

  const [year, setYear] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [minors, setMinors] = useState<string[]>([]);
  const [search, setSearch] = useState<string>("");
  const [optionalOpen, setOptionalOpen] = useState(false);

  // 每次「打开」时用当前 profile / 数据源重新校准（仅在 open 翻转时执行——
  // programs refetch 会产生新数组引用，不能作为依赖触发，否则用户填写中途被重置）
  const prevOpen = useRef(false);
  useEffect(() => {
    if (prevOpen.current === open) return;
    prevOpen.current = open;
    if (!open) return;
    const nextYear = initialYear && years.includes(initialYear) ? initialYear : years[0] ?? "";
    const nextCode =
      initialCode && codesOf(programs, nextYear).some((p) => p.code === initialCode)
        ? initialCode
        : "";
    setYear(nextYear);
    setCode(nextCode);
    setMinors(initialMinors && initialMinors.length ? [...initialMinors] : []);
    setSearch("");
    setOptionalOpen(Boolean(initialMinors && initialMinors.length));
  }, [open, programs, years, initialYear, initialCode, initialMinors]);

  const majors = useMemo(() => codesOf(programs, year), [programs, year]);
  const canSubmit = Boolean(year && code);

  // 学院随主修自动推导（schoolOf 映射）；无映射的学院显示"未收录"
  const school = code ? schoolOf(code) : "";
  const schoolName = school ? SCHOOL_CN[school] ?? school : "";

  // 学院要求自动匹配：主修属 SSCI / SBM 时自动附加该学年 SREQ
  const schoolAttached = useMemo(
    () => resolveAttachedPrograms(year, code, [], programs).find((a) => a.kind === "school"),
    [year, code, programs]
  );

  // 辅修 / EXTM 可选列表（按学年过滤 + 搜索过滤）
  const selectable = useMemo(() => selectableAttached(year, programs), [year, programs]);
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return selectable;
    return selectable.filter(
      (x) => x.code.toLowerCase().includes(kw) || x.title.toLowerCase().includes(kw)
    );
  }, [selectable, search]);

  const toggleMinor = (target: string) =>
    setMinors((prev) =>
      prev.includes(target) ? prev.filter((c) => c !== target) : [...prev, target]
    );

  const selectYear = (next: string) => {
    setYear(next);
    // 换学年后原主修可能不存在，重置让用户重新选
    if (!codesOf(programs, next).some((p) => p.code === code)) setCode("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // forced（无有效 profile）时禁止任何途径关闭；否则 X / ESC / 点遮罩均视为取消
        if (!next && !forced) onCancel?.();
      }}
    >
      <DialogContent
        showCloseButton={!forced}
        onEscapeKeyDown={(e) => {
          if (forced) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (forced) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (forced) e.preventDefault();
        }}
        className="flex max-h-[90vh] flex-col overflow-hidden p-0"
      >
        <DialogHeader className="px-6 pb-2 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <GraduationCap className="h-4 w-4" />
            </span>
            先告诉我你的入学信息
          </DialogTitle>
          <DialogDescription>
            用于匹配对应学年的培养方案；记录只存在本机浏览器，不会上传服务器。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <Field label="入学年份" hint="以录取通知书上的学年为准">
            {/* value 恒为字符串（未选时为空串），避免 Radix 在受控/非受控之间切换；空串同样会显示 placeholder */}
            <Select value={year} onValueChange={selectYear}>
              <SelectTrigger aria-label="入学年份">
                <SelectValue placeholder="请选择入学年份" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y} 学年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* 学院：随主修自动推导（schoolOf 映射），无需手选 */}
          <Field label="学院" hint="由所选主修自动识别">
            <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              {code ? schoolName || "该主修学院未收录" : "选择主修后自动显示"}
            </div>
          </Field>

          <Field label="主修" hint="决定默认展示的培养方案">
            <Select value={code} onValueChange={setCode} disabled={!year}>
              <SelectTrigger aria-label="主修" className={cn(!year && "cursor-not-allowed")}>
                <SelectValue
                  placeholder={year ? "请选择主修专业" : "请先选择入学年份"}
                />
              </SelectTrigger>
              <SelectContent>
                {majors.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.code} · {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* 学院要求自动匹配提示（仅 SSCI / SBM 主修显示） */}
          {schoolAttached && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                schoolAttached.available
                  ? "border-success/30 bg-success/5 text-success"
                  : "border-warning/30 bg-warning/5 text-warning"
              )}
            >
              <School className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="leading-relaxed">
                {schoolAttached.available
                  ? `已自动加入 ${SCHOOL_CN[school]}的学院要求（School Requirements），可与主修要求叠加查看进度。`
                  : `${SCHOOL_CN[school]}的学院要求数据在 ${year} 学年暂缺，已跳过。`}
              </span>
            </div>
          )}

          {/* 选填：Extended Major / Minor —— 真实多选（数据驱动） */}
          <div className="rounded-md border border-dashed bg-muted/30">
            <button
              type="button"
              data-testid="onboarding-optional-toggle"
              onClick={() => setOptionalOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-expanded={optionalOpen}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                选填：辅修 Minor / Extended Major
              </span>
              <span className="flex items-center gap-2">
                {minors.length > 0 && (
                  <Badge className="font-normal">已选 {minors.length}</Badge>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    optionalOpen && "rotate-180"
                  )}
                />
              </span>
            </button>
            {optionalOpen && (
              <div className="border-t border-dashed px-3 py-2.5">
                {!year ? (
                  <p className="text-xs text-muted-foreground">请先选择入学年份</p>
                ) : selectable.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {year} 学年暂无可选的辅修 / Extended Major 数据
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索辅修 / Extended Major…"
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                      {filtered.map((x) => {
                        const checked = minors.includes(x.code);
                        return (
                          <label
                            key={x.code}
                            className={cn(
                              "flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                              checked
                                ? "border-primary/40 bg-primary/5"
                                : "hover:bg-accent/60"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMinor(x.code)}
                              className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))] cursor-pointer"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-mono text-[10px] text-muted-foreground mr-1.5">
                                {x.code}
                              </span>
                              {x.title}
                            </span>
                            <Badge variant="outline" className="shrink-0 font-normal text-[10px]">
                              {x.kind === "extm" ? "EXTM" : "辅修"}
                            </Badge>
                            {checked && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                            )}
                          </label>
                        );
                      })}
                      {filtered.length === 0 && (
                        <p className="py-2 text-center text-xs text-muted-foreground">
                          没有匹配「{search}」的项目
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      可多选；所选要求的课程会与主修进度叠加显示，勾选记录跨方案共享。
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t bg-card px-6 py-4">
          {onImportTranscript && (
            <Button variant="outline" className="mr-auto gap-1.5" onClick={onImportTranscript}>
              <FileUp className="h-3.5 w-3.5" />
              从成绩单导入
            </Button>
          )}
          {!forced && (
            <Button variant="ghost" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button
            disabled={!canSubmit}
            data-testid="onboarding-submit"
            onClick={() => canSubmit && onSubmit({ year, code, minors })}
            className="min-w-[88px]"
          >
            进入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  badge,
  children,
}: {
  label: string;
  hint?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">
          {label}
          {!badge && <span className="ml-1 text-destructive">*</span>}
        </label>
        {badge && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {badge}
          </Badge>
        )}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

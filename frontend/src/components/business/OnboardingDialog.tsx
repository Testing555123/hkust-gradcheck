import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, FileUp, GraduationCap, Lock, Sparkles } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { codesOf, yearsOf } from "@/lib/profile";
import { cn } from "@/lib/utils";
import type { ProgramInfo } from "@/types";

interface OnboardingDialogProps {
  open: boolean;
  programs: ProgramInfo[];
  /** 无 profile 或 profile 失效时为 true：禁止 ESC / 点遮罩关闭，且不提供取消 */
  forced: boolean;
  initialYear?: string;
  initialCode?: string;
  onSubmit: (sel: { year: string; code: string }) => void;
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
  onSubmit,
  onCancel,
  onImportTranscript,
}: OnboardingDialogProps) {
  const years = useMemo(() => yearsOf(programs), [programs]);

  const [year, setYear] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [optionalOpen, setOptionalOpen] = useState(false);

  // 每次打开时用当前 profile / 数据源重新校准，避免上一次的临时选择残留
  useEffect(() => {
    if (!open) return;
    const nextYear = initialYear && years.includes(initialYear) ? initialYear : years[0] ?? "";
    const nextCode =
      initialCode && codesOf(programs, nextYear).some((p) => p.code === initialCode)
        ? initialCode
        : "";
    setYear(nextYear);
    setCode(nextCode);
    setOptionalOpen(false);
  }, [open, programs, years, initialYear, initialCode]);

  const majors = useMemo(() => codesOf(programs, year), [programs, year]);
  const canSubmit = Boolean(year && code);

  const selectYear = (next: string) => {
    setYear(next);
    // 换学年后原主修可能不存在，重置让用户重新选
    if (!codesOf(programs, next).some((p) => p.code === code)) setCode("");
  };

  return (
    <Dialog open={open}>
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
      >
        <DialogHeader>
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

        <div className="space-y-4">
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

          {/* 学院：字段位已保留，后端暂未接入数据 */}
          <Field
            label="学院"
            badge="数据准备中"
            hint="学院数据尚未接入，暂不影响培养方案匹配"
          >
            <Select value={undefined} disabled>
              <SelectTrigger aria-label="学院" className="cursor-not-allowed">
                <SelectValue placeholder="暂未开放" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__placeholder">暂未开放</SelectItem>
              </SelectContent>
            </Select>
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

          {/* 选填：Extended Major / Minor —— 暂未开放，可跳过 */}
          <div className="rounded-md border border-dashed bg-muted/30">
            <button
              type="button"
              onClick={() => setOptionalOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-expanded={optionalOpen}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                选填：Extended Major / Minor
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="outline" className="font-normal">
                  暂未开放
                </Badge>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    optionalOpen && "rotate-180"
                  )}
                />
              </span>
            </button>
            {optionalOpen && (
              <div className="border-t border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Lock className="h-3 w-3" />
                  辅修与 Extended Major 的要求数据仍在整理中，开放后会在这里追加，不影响你继续查看主修进度。
                </span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
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
            onClick={() => canSubmit && onSubmit({ year, code })}
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

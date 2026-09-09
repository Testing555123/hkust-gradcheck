import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Info, Sparkles } from "lucide-react";
import type { BranchOption } from "@/types";

interface BranchSelectorProps {
  /** 一级分支清单（由 lib/branch.ts 聚合） */
  branches: BranchOption[];
  /** 公共核心学分（非分支组之和） */
  coreCredits: number;
  selectedBranch: string | null;
  selectedSubBranch: string | null;
  onChange: (branch: string | null, subBranch?: string | null) => void;
  /** 供「选择方向」按钮锚点滚动定位 */
  id?: string;
}

const triggerClass =
  "h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer sm:w-[320px]";

/**
 * 主修内部互斥分支（Track / Option）选择器。
 *
 * 同一主修的各分支学分下限不同（如 2025-26 MATH 从 +24 到 +43），
 * 未选方向时进度只计公共核心，并给出提示条引导用户选择。
 */
export function BranchSelector({
  branches,
  coreCredits,
  selectedBranch,
  selectedSubBranch,
  onChange,
  id,
}: BranchSelectorProps) {
  if (branches.length === 0) return null;

  const current = branches.find((b) => b.name === selectedBranch) ?? null;
  const children = current?.children ?? [];

  return (
    <div
      id={id}
      className="scroll-mt-20 rounded-lg border bg-card px-4 py-3 shadow-flat animate-fade-in-up"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            选择你的方向（Track / Option）
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            本专业含 {branches.length} 个互斥方向，各方向学分下限不同，择一修读后才会计入进度
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            value={selectedBranch ?? ""}
            onValueChange={(v) => onChange(v === "__none__" ? null : v)}
          >
            <SelectTrigger className={triggerClass} aria-label="主修方向">
              <SelectValue placeholder="未选择方向" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="cursor-pointer">
                <span className="flex w-full items-center gap-2">
                  <span>未选择（仅计核心 {coreCredits} 学分）</span>
                </span>
              </SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.name} value={b.name} className="cursor-pointer">
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate">{b.name}</span>
                    <span className="ml-auto shrink-0 text-caption tabular-nums text-muted-foreground">
                      +{b.credits} 学分
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {current && (
            <p className="text-xs tabular-nums text-muted-foreground">
              核心 {coreCredits} + {current.name} {current.credits} ={" "}
              <strong className="text-foreground">
                {coreCredits + current.credits + (selectedSubBranch
                  ? (children.find((c) => c.name === selectedSubBranch)?.credits ?? 0)
                  : 0)}
              </strong>{" "}
              学分
            </p>
          )}
        </div>
      </div>

      {/* 二级分支：父分支选定后才出现，未勾选不计入分母 */}
      {children.length > 0 && (
        <div className="mt-3 border-l border-border pl-3 sm:pl-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {current?.name} 下的细分方向（可不选）
          </p>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => {
              const active = selectedSubBranch === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange(current!.name, active ? null : c.name)}
                  className={cn(
                    "inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs transition-colors sm:min-h-0 sm:py-1.5",
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {c.name}
                  <span className="tabular-nums opacity-70">+{c.credits}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 未选分支时的提示条（Overview / Requirements 共用）。
 * info 描边条而非实心块，避免抢占第一屏焦点；点击「选择方向」直达选择器。
 */
export function BranchNotice({
  branchCount,
  coreCredits,
  onPick,
}: {
  branchCount: number;
  coreCredits: number;
  onPick?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-info/40 bg-info/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
      <span className="flex min-w-0 items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span className="min-w-0">
          本专业含 <strong className="text-foreground">{branchCount}</strong> 个互斥
          Track / Option，各方向学分下限不同。未选择方向时仅按公共核心{" "}
          <strong className="text-foreground">{coreCredits}</strong> 学分计算。
        </span>
      </span>
      {onPick && (
        <Button
          variant="link"
          size="sm"
          onClick={onPick}
          className="h-auto shrink-0 self-start p-0 text-info sm:self-auto"
        >
          选择方向
        </Button>
      )}
    </div>
  );
}

/** 分支类型小徽标：Track / Option */
export function BranchKindBadge({ kind }: { kind: BranchOption["kind"] }) {
  return (
    <Badge
      variant="secondary"
      className="rounded-full px-2 text-caption font-normal text-muted-foreground"
    >
      {kind === "track" ? "Track" : "Option"}
    </Badge>
  );
}

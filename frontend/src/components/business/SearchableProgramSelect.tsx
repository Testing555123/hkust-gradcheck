import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { filterPrograms, groupPrograms, type ProgramKind } from "@/lib/program-groups";
import type { ProgramInfo } from "@/types";

interface SearchableProgramSelectProps {
  programs: ProgramInfo[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  /** 限定可选类别；不传则四类全列（顶栏浏览用），传 ["major"] 则只列主修（引导弹窗用） */
  kinds?: ProgramKind[];
}

/**
 * 带关键字搜索 + 分类分组的方案下拉。
 *
 * shadcn 的 Select 基于 Radix，不支持内建搜索框，这里在 SelectContent 顶部放一个 Input：
 * 拦截 keydown / pointerdown 的冒泡，避免输入被 Radix 的 typeahead 与焦点管理抢走。
 */
export function SearchableProgramSelect({
  programs,
  value,
  onChange,
  disabled,
  placeholder = "请选择",
  ariaLabel,
  triggerClassName,
  kinds,
}: SearchableProgramSelectProps) {
  const [keyword, setKeyword] = useState("");

  const groups = useMemo(
    () => groupPrograms(filterPrograms(programs, keyword), kinds),
    [programs, keyword, kinds]
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      onOpenChange={(open) => {
        // 每次打开重置搜索词，避免上次残留导致列表看起来是空的
        if (open) setKeyword("");
      }}
    >
      <SelectTrigger className={triggerClassName} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[70vh]">
        {/* 搜索框：阻止事件冒泡，否则 Radix 会把按键当作选项 typeahead */}
        <div
          className="sticky top-0 z-10 -mt-1 bg-popover px-1 pb-1 pt-1"
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索专业代码或名称…"
              className="h-8 pl-8 text-sm"
              autoFocus
            />
          </div>
        </div>

        {total === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            没有匹配「{keyword.trim()}」的培养方案
          </p>
        )}

        {groups.map((g) => (
          <SelectGroup key={g.kind}>
            <SelectLabel className="text-[11px] font-medium text-muted-foreground">
              {g.label} · {g.items.length}
            </SelectLabel>
            {g.items.map((p) => (
              <SelectItem key={p.code} value={p.code}>
                <span className="font-mono text-[11px] text-muted-foreground mr-1.5">
                  {p.code}
                </span>
                {p.title}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

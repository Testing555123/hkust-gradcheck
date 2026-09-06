import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUi } from "@/stores/ui";
import type { ProgramInfo } from "@/types";
import { useEffect } from "react";

interface ProgramPickerProps {
  programs: ProgramInfo[];
}

const triggerClass =
  "h-9 w-[190px] rounded-md border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer";

/** 学年 / 专业双下拉选择器（shadcn Select 风格） */
export function ProgramPicker({ programs }: ProgramPickerProps) {
  const { year, code, setProgram } = useUi();

  const years = Array.from(new Set(programs.map((p) => p.year))).sort().reverse();
  const codes = Array.from(
    new Map(programs.filter((p) => !year || p.year === year).map((p) => [p.code, p])).values()
  ).sort((a, b) => a.code.localeCompare(b.code));

  // 默认选中第一个可用项
  useEffect(() => {
    if (!programs.length) return;
    const known = programs.some((p) => p.year === year && p.code === code);
    if (!known) {
      const first = programs[0];
      setProgram(first.year, first.code);
    }
  }, [programs, year, code, setProgram]);

  return (
    <div className="flex items-center gap-2">
      <Select value={year} onValueChange={(v) => {
        const firstInYear = programs.find((p) => p.year === v);
        setProgram(v, firstInYear?.code ?? "");
      }}>
        <SelectTrigger className={triggerClass} aria-label="学年">
          <SelectValue placeholder="学年" />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={code} onValueChange={(v) => setProgram(year, v)} disabled={!year}>
        <SelectTrigger className={triggerClass} aria-label="专业">
          <SelectValue placeholder="专业" />
        </SelectTrigger>
        <SelectContent>
          {codes.map((p) => (
            <SelectItem key={p.code} value={p.code}>
              {p.code} · {p.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUi } from "@/stores/ui";
import { useProfile } from "@/stores/profile";
import { codesOf, resolveSelection } from "@/lib/profile";
import type { ProgramInfo } from "@/types";
import { useEffect } from "react";

interface ProgramPickerProps {
  programs: ProgramInfo[];
}

const triggerClass =
  "h-9 w-[190px] rounded-md border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer";

/** 学年 / 专业双下拉选择器（shadcn Select 风格）；切换结果会回写 profile */
export function ProgramPicker({ programs }: ProgramPickerProps) {
  const { year, code, setProgram } = useUi();
  const profile = useProfile((s) => s.profile);
  const setProfileProgram = useProfile((s) => s.setProgram);

  const years = Array.from(new Set(programs.map((p) => p.year))).sort().reverse();
  const codes = Array.from(
    new Map(programs.filter((p) => !year || p.year === year).map((p) => [p.code, p])).values()
  ).sort((a, b) => a.code.localeCompare(b.code));

  // profile 有效则优先 profile，否则回退到最新学年的第一个专业
  useEffect(() => {
    if (!programs.length) return;
    const target = resolveSelection(profile, programs);
    if (!target) return;
    if (target.year !== year || target.code !== code) {
      setProgram(target.year, target.code);
    }
  }, [programs, profile, year, code, setProgram]);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={year}
        onValueChange={(v) => {
          const firstInYear = codesOf(programs, v)[0];
          if (!firstInYear) return;
          // 顶栏切换即视为最近一次选择，回写 profile
          setProfileProgram(firstInYear.year, firstInYear.code);
          setProgram(firstInYear.year, firstInYear.code);
        }}
      >
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

      <Select
        value={code}
        onValueChange={(v) => {
          setProfileProgram(year, v);
          setProgram(year, v);
        }}
        disabled={!year}
      >
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

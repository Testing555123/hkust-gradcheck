import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableProgramSelect } from "@/components/business/SearchableProgramSelect";
import { useUi } from "@/stores/ui";
import { useProfile } from "@/stores/profile";
import { codesOf, resolveSelection } from "@/lib/profile";
import { useEffect } from "react";
import type { ProgramInfo } from "@/types";

interface ProgramPickerProps {
  programs: ProgramInfo[];
}

const triggerClass =
  "h-9 w-[190px] rounded-md border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer";

/** 学年 / 培养方案双下拉选择器：方案下拉支持关键字搜索并按类别分组 */
export function ProgramPicker({ programs }: ProgramPickerProps) {
  const { year, code, setProgram } = useUi();
  const profile = useProfile((s) => s.profile);
  const setProfileProgram = useProfile((s) => s.setProgram);

  const years = Array.from(new Set(programs.map((p) => p.year))).sort().reverse();
  const inYear = codesOf(programs, year);

  // profile 有效则优先 profile，否则回退到最新学年的第一个主修
  useEffect(() => {
    if (!programs.length) return;
    const target = resolveSelection(profile, programs);
    if (!target) return;
    if (target.year !== year || target.code !== code) {
      setProgram(target.year, target.code);
    }
  }, [programs, profile, year, code, setProgram]);

  const pick = (nextYear: string, nextCode: string) => {
    setProfileProgram(nextYear, nextCode);
    setProgram(nextYear, nextCode);
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={year}
        onValueChange={(v) => {
          const first = codesOf(programs, v)[0];
          if (!first) return;
          // 顶栏切换即视为最近一次选择，回写 profile
          pick(first.year, first.code);
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

      <SearchableProgramSelect
        programs={inYear}
        value={code}
        onChange={(v) => pick(year, v)}
        disabled={!year}
        placeholder="培养方案"
        ariaLabel="培养方案"
        triggerClassName={triggerClass}
      />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { FileText, FileUp, Loader2, TriangleAlert } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSelection } from "@/stores/selection";
import { codesOf, yearsOf } from "@/lib/profile";
import {
  extractTranscriptText,
  parseTranscript,
  TranscriptParseError,
  type TranscriptCourse,
  type TranscriptCourseStatus,
  type TranscriptInfo,
} from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { ProgramInfo } from "@/types";

export interface TranscriptImportResult {
  year: string;
  code: string;
  courses: Record<string, TranscriptCourseStatus>;
  /** Admit Date 推导的入学学年（通识框架判定用） */
  admissionYear?: string | null;
}

interface TranscriptImportDialogProps {
  open: boolean;
  programs: ProgramInfo[];
  onClose: () => void;
  onConfirm: (result: TranscriptImportResult) => void;
}

/** 成绩单导入：上传（本机解析）→ 预览确认（学期分组/冲突标黄/学年主修预填） */
export function TranscriptImportDialog({
  open,
  programs,
  onClose,
  onConfirm,
}: TranscriptImportDialogProps) {
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [parsing, setParsing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptInfo | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [year, setYear] = useState("");
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const existing = useSelection((s) => s.status);
  const years = useMemo(() => yearsOf(programs), [programs]);
  const majors = useMemo(() => codesOf(programs, year), [programs, year]);

  useEffect(() => {
    if (!open) {
      setStep("upload");
      setResult(null);
      setError(null);
      setExcluded(new Set());
      setParsing(false);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    if (parsing) return;
    setError(null);
    setParsing(true);
    try {
      const text = await extractTranscriptText(file);
      const info = parseTranscript(text);
      const list = yearsOf(programs);
      const y =
        info.effectiveYear && list.includes(info.effectiveYear) ? info.effectiveYear : list[0] ?? "";
      setResult(info);
      setExcluded(new Set());
      setYear(y);
      setCode(suggestMajorCode(info.major, codesOf(programs, y)));
      setStep("preview");
    } catch (e) {
      setError(e instanceof TranscriptParseError ? e.message : "解析失败，请重试，或继续使用手动勾选。");
    } finally {
      setParsing(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const included = useMemo(
    () => result?.courses.filter((c) => !excluded.has(c.code)) ?? [],
    [result, excluded]
  );
  const takenCount = included.filter((c) => c.status === "taken").length;
  const plannedCount = included.length - takenCount;

  const grouped = useMemo(() => {
    if (!result) return [];
    return result.terms
      .map((term) => ({ term, rows: included.filter((c) => c.term === term) }))
      .filter((g) => g.rows.length > 0);
  }, [result, included]);

  const toggleRow = (courseCode: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(courseCode)) next.delete(courseCode);
      else next.add(courseCode);
      return next;
    });
  };

  const handleConfirm = () => {
    if (!result || included.length === 0 || !year || !code) return;
    const courses: Record<string, TranscriptCourseStatus> = {};
    for (const c of included) courses[c.code] = c.status;
    onConfirm({ year, code, courses, admissionYear: result.admitYear ?? null });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            从成绩单导入
          </DialogTitle>
          <DialogDescription>
            上传 SIS 的 Unofficial Transcript PDF，全部解析在本机完成，文件不会上传服务器。
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
                dragActive
                  ? "border-primary bg-primary/5"
                  : "hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              {parsing ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <FileUp className="h-8 w-8 text-muted-foreground" />
              )}
              <p className="text-sm font-medium">
                {parsing ? "正在本机解析…" : "拖拽成绩单 PDF 到此处，或点击选择文件"}
              </p>
              <p className="text-xs text-muted-foreground">
                支持 SIS 导出的 Unofficial Transcript（文字版 PDF）
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {step === "preview" && result && (
          <>
            <div className="space-y-3 overflow-y-auto pr-1">
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="max-w-full font-normal">
                    {result.major || "未识别到主修信息"}
                  </Badge>
                  {result.programChangeYear && (
                    <Badge variant="secondary" className="font-normal">
                      转专业生效 {result.programChangeYear}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">要求树学年</p>
                    <Select value={year} onValueChange={setYear}>
                      <SelectTrigger aria-label="要求树学年" className="h-8 text-xs">
                        <SelectValue placeholder="选择学年" />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={y}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">主修</p>
                    <Select value={code} onValueChange={setCode}>
                      <SelectTrigger aria-label="主修" className="h-8 text-xs">
                        <SelectValue placeholder="选择主修" />
                      </SelectTrigger>
                      <SelectContent>
                        {majors.map((p) => (
                          <SelectItem key={p.code} value={p.code}>
                            {p.code} · {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {result.warnings.length > 0 && (
                <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                  {result.warnings.map((w) => (
                    <p key={w} className="flex items-start gap-1.5">
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                {grouped.map(({ term, rows }) => (
                  <div key={term} className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">{term}</p>
                    {rows.map((c) => {
                      const conflict =
                        existing[c.code] !== undefined && existing[c.code] !== c.status;
                      return (
                        <label
                          key={c.code}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors",
                            excluded.has(c.code) && "opacity-45",
                            conflict
                              ? "border-warning/50 bg-warning/10"
                              : c.status === "taken"
                                ? "border-success/25 bg-success/5"
                                : "border-primary/25 bg-primary/5"
                          )}
                        >
                          <Checkbox
                            checked={!excluded.has(c.code)}
                            onCheckedChange={() => toggleRow(c.code)}
                            aria-label={`导入 ${c.code}`}
                          />
                          <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                          <Badge variant={c.status === "taken" ? "success" : "secondary"} className="shrink-0">
                            {c.status === "taken" ? `已修 ${c.grade}` : "在读"}
                          </Badge>
                          {conflict && <span className="shrink-0 text-[10px] text-warning">与现有勾选不同</span>}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter className="items-center justify-between gap-2 border-t pt-3 sm:justify-between">
              <p className="text-xs text-muted-foreground">
                将导入 <span className="font-medium text-success">{takenCount}</span> 门已修 /{" "}
                <span className="font-medium text-primary">{plannedCount}</span> 门在读；已修以成绩单为准，手动勾选的计划保留
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={onClose}>
                  取消
                </Button>
                <Button onClick={handleConfirm} disabled={included.length === 0 || !year || !code}>
                  确认导入
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 用 Major 原文对库里专业标题做最佳匹配（取括号前的主干词） */
function suggestMajorCode(major: string | undefined, majors: ProgramInfo[]): string {
  if (!major) return "";
  const root = major.split("(")[0].trim().toLowerCase();
  if (!root) return "";
  return majors.find((p) => p.title.toLowerCase().includes(root))?.code ?? "";
}

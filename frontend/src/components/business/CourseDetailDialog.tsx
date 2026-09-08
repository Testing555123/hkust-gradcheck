import type { ReactNode } from "react";
import { ArrowRight, BookOpen, CalendarRange, GraduationCap, Info } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Sheet } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useCourseLookup } from "@/hooks/queries";
import { useUi } from "@/stores/ui";
import { useProfile } from "@/stores/profile";
import { schoolOf } from "@/lib/common-core";

/**
 * 课程详情：官方课程库的学分/先修/开设学期 + 反向索引（被哪些方案要求）。
 *
 * 双容器：桌面用居中 Dialog，小屏用底部抽屉（Sheet）—— 弹窗在窄屏会挤压内容，
 * 抽屉更贴合移动端手势直觉。课程表与反向索引合计约 1.1MB，仅在首次打开时加载并缓存。
 */
export function CourseDetailDialog() {
  const code = useUi((s) => s.courseCode);
  const closeCourse = useUi((s) => s.closeCourse);
  const setProgram = useUi((s) => s.setProgram);
  const setProfileProgram = useProfile((s) => s.setProgram);
  const isDesktop = useIsDesktop();

  const { detail, references, referenceTotal, isLoading, isError, missing } =
    useCourseLookup(code);

  const jumpTo = (year: string, programCode: string) => {
    setProfileProgram(year, programCode, { admissionYear: year, school: schoolOf(programCode) || null });
    setProgram(year, programCode);
    closeCourse();
  };

  const open = Boolean(code);
  const handleOpenChange = (next: boolean) => !next && closeCourse();

  const body = (
    <>
      {isLoading && (
        <div className="space-y-2">
          <div className="h-16 animate-pulse-soft rounded-md bg-muted" />
          <div className="h-10 animate-pulse-soft rounded-md bg-muted" />
        </div>
      )}

      {isError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          课程数据加载失败，请检查网络后重试。
        </p>
      )}

      {!isLoading && !isError && detail && (
        <div className="space-y-3">
          <div className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
            <Row icon={<BookOpen className="h-3.5 w-3.5" />} label="学分">
              {detail.credits || "—"}
            </Row>
            <Row icon={<CalendarRange className="h-3.5 w-3.5" />} label="开设学期">
              {detail.offered_semesters || "—"}
            </Row>
            <Row icon={<Info className="h-3.5 w-3.5" />} label="先修要求">
              {detail.prerequisites || "无特殊先修要求"}
            </Row>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                被 {referenceTotal} 处要求引用
                {references.length < referenceTotal && `（仅列出前 ${references.length} 条）`}
              </p>
              {references.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {references.length} 条
                </Badge>
              )}
            </div>

            {references.length === 0 ? (
              <EmptyState
                icon={<Info className="mx-auto h-8 w-8 text-muted-foreground" />}
                title="没有出现在任何培养方案的要求组里"
                description="该课可能是通识/选修课，或仅作为示例出现在 PDF 说明文字中。"
              />
            ) : (
              <ul className="max-h-[40vh] space-y-1 overflow-y-auto pr-1">
                {references.map((r, i) => (
                  <li key={`${r.year}-${r.code}-${i}`}>
                    <button
                      type="button"
                      onClick={() => jumpTo(r.year, r.code)}
                      className="flex min-h-[44px] w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-accent/60 md:min-h-0"
                    >
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {r.year}
                      </Badge>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {r.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.group}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {r.credits} 学分
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {!isLoading && !isError && missing && (
        <div className="space-y-2">
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            官方课程库（courses.db）中没有该课号，可能是培养方案里的占位写法
            （如「ECON 4000-level Electives」）或尚未收录的新课。
          </p>
        </div>
      )}
    </>
  );

  // 小屏：底部抽屉
  if (!isDesktop) {
    return (
      <Sheet
        open={open}
        onOpenChange={handleOpenChange}
        title={code ?? "课程详情"}
        description={
          isLoading
            ? "正在查询官方课程库…"
            : detail?.title ?? "官方课程库中未收录该课号"
        }
      >
        <div data-testid="course-detail-dialog">{body}</div>
      </Sheet>
    );
  }

  // 桌面：居中弹窗
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[560px]" data-testid="course-detail-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" />
            <span className="font-mono">{code}</span>
          </DialogTitle>
          <DialogDescription>
            {isLoading ? "正在查询官方课程库…" : detail?.title ?? "官方课程库中未收录该课号"}
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

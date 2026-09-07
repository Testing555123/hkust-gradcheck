import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnboardingDialog } from "@/components/business/OnboardingDialog";
import { TranscriptImportDialog, type TranscriptImportResult } from "@/components/business/TranscriptImportDialog";
import { ProfileBadge } from "@/components/business/ProfileBadge";
import { CourseDetailDialog } from "@/components/business/CourseDetailDialog";
import { ProgramPicker } from "@/components/business/ProgramPicker";
import { EmptyState } from "@/components/ui/empty";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { OverviewPage } from "@/pages/OverviewPage";
import { CoursesPage } from "@/pages/CoursesPage";
import { RequirementsPage } from "@/pages/RequirementsPage";
import { usePrograms, useProgramTree, useAttachedTrees } from "@/hooks/queries";
import { useUi } from "@/stores/ui";
import { useProfile } from "@/stores/profile";
import { useSelection } from "@/stores/selection";
import { computeProgramAudit } from "@/lib/audit";
import { needsOnboarding } from "@/lib/profile";
import { schoolOf } from "@/lib/common-core";
import { resolveAttachedPrograms } from "@/lib/attached";
import { Moon, Sun, GraduationCap, LayoutDashboard, ListChecks, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function App() {
  const programs = usePrograms();
  const {
    year,
    code,
    theme,
    toggleTheme,
    setProgram,
    onboardingOpen,
    openOnboarding,
    closeOnboarding,
    transcriptImportOpen,
    openTranscriptImport,
    closeTranscriptImport,
  } = useUi();
  const profile = useProfile((s) => s.profile);
  const setProfileProgram = useProfile((s) => s.setProgram);
  const selectionStatus = useSelection((s) => s.status);
  const setSelectionMany = useSelection((s) => s.setMany);
  const tree = useProgramTree(year, code);

  const list = programs.data ?? [];
  // 附加方案：辅修（profile.minors 多选）+ 学院要求（schoolOf 自动匹配）
  const attached = useMemo(
    () => resolveAttachedPrograms(year, code, profile?.minors ?? [], list, profile?.school),
    [year, code, profile?.minors, profile?.school, list]
  );
  const attachedTrees = useAttachedTrees(attached);

  // 刷新后 useUi 的选择会重置（非持久化）：profile 有效时用它校准，
  // 保证附加要求（辅修/学院）与主修保持在同一学年/专业
  useEffect(() => {
    if (programs.isLoading || list.length === 0) return;
    if (year && code) return; // 已有有效选择（用户手动切换或已同步）
    if (profile && list.some((p) => p.year === profile.year && p.code === profile.code)) {
      setProgram(profile.year, profile.code);
    }
  }, [programs.isLoading, list, year, code, profile, setProgram]);
  // 数据源为空时不弹（没得选）；profile 缺失或已失效时强制引导
  const mustOnboard = !programs.isLoading && needsOnboarding(profile, list);
  const dialogOpen = mustOnboard || onboardingOpen;

  // Tab 计数徽标数据（与 OverviewPage 同源，计算成本可忽略）
  const audit = tree.data ? computeProgramAudit(tree.data.groups, selectionStatus) : null;

  // 应用主题到 <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // 切换培养方案的全局反馈（首次保存不提示，避免与引导弹窗重复）
  const lastProfileKey = useRef<string | null>(
    profile ? `${profile.year}/${profile.code}` : null
  );
  useEffect(() => {
    const key = profile ? `${profile.year}/${profile.code}` : null;
    if (key && profile && lastProfileKey.current && key !== lastProfileKey.current) {
      toast.success(`已切换到 ${profile.year} ${profile.code}`);
    }
    lastProfileKey.current = key;
  }, [profile]);

  const handleSubmit = (sel: { year: string; code: string; minors: string[] }) => {
    // 手动选择时，所选年份即入学年份（通识框架判定用）
    setProfileProgram(sel.year, sel.code, { admissionYear: sel.year });
    useProfile.getState().setMinors(sel.minors);
    setProgram(sel.year, sel.code);
    closeOnboarding();
  };

  const handleRemoveMinor = (minorCode: string) => {
    const next = (profile?.minors ?? []).filter((c) => c !== minorCode);
    useProfile.getState().setMinors(next);
    toast.info(`已移除辅修 / Extended Major：${minorCode}`);
  };

  // 成绩单导入：已修以成绩单覆盖，手动勾选的计划保留；profile 同步填充（含通识框架字段）
  const handleTranscriptConfirm = (r: TranscriptImportResult) => {
    setSelectionMany(r.courses);
    setProfileProgram(r.year, r.code, {
      admissionYear: r.admissionYear ?? null,
      school: schoolOf(r.code) || null,
    });
    // 写回识别到的副修 / Extended Major（与手动选填共用 profile.minors）
    useProfile.getState().setMinors(r.minors ?? []);
    setProgram(r.year, r.code);
    closeTranscriptImport();
    const taken = Object.values(r.courses).filter((s) => s === "taken").length;
    toast.success(`已导入 ${taken} 门已修 / ${Object.keys(r.courses).length - taken} 门在读计划`);
  };

  return (
    <div className="min-h-screen">
      {/* 固定顶栏 */}
      <header className="fixed top-0 inset-x-0 z-40 h-14 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-6xl h-full px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <GraduationCap className="h-5 w-5 text-primary shrink-0" />
            <h1 className="font-semibold text-sm sm:text-base truncate">畢業要求查詢與學分核查</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* 窄屏隐藏双下拉，只保留身份摘要入口，避免顶栏拥挤 */}
            {programs.data && programs.data.length > 0 && (
              <div className="hidden sm:block">
                <ProgramPicker programs={programs.data} />
              </div>
            )}
            {year && code && <ProfileBadge year={year} code={code} onClick={openOnboarding} />}
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="切换主题">
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* 主内容（预留顶栏高度） */}
      <main className="mx-auto max-w-6xl px-4 pt-[72px] pb-16">
        {programs.isLoading && <PageSkeleton />}
        {programs.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
            无法加载培养方案列表：请确认后端服务已启动（uvicorn，端口 8000）。
            <br />
            <span className="text-muted-foreground">{String(programs.error)}</span>
          </div>
        )}

        {programs.data && programs.data.length === 0 && (
          <EmptyState
            icon={<GraduationCap className="h-10 w-10 mx-auto text-muted-foreground" />}
            title="数据库中还没有培养方案"
            description={
              <>
                请先运行离线管线解析 PDF 并用 seed 导入：
                <br />
                <code className="text-xs font-mono">py -m run_pipeline --year 2026-27 --code COMP</code>
                <br />
                <code className="text-xs font-mono">python backend/scripts/seed.py</code>
              </>
            }
          />
        )}

        {programs.data && programs.data.length > 0 && (
          <>
            {tree.isLoading && <PageSkeleton />}
            {tree.isError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
                加载培养方案失败：
                <span className="text-muted-foreground">{String(tree.error)}</span>
              </div>
            )}
            {tree.data && (
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview" className="gap-1.5">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    方案总览
                  </TabsTrigger>
                  <TabsTrigger value="courses" className="gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" />
                    课程选择
                    {audit && audit.missingCount > 0 && (
                      <span className="rounded-full bg-warning/15 px-1.5 text-[10px] leading-4 text-warning tabular-nums">
                        缺 {audit.missingCount}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="requirements" className="gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    要求明细
                    <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground tabular-nums">
                      {tree.data.groups.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <OverviewPage
                    tree={tree.data}
                    attachedEntries={attachedTrees}
                    onRemoveMinor={handleRemoveMinor}
                  />
                </TabsContent>
                <TabsContent value="courses">
                  <CoursesPage tree={tree.data} attachedEntries={attachedTrees} />
                </TabsContent>
                <TabsContent value="requirements">
                  <RequirementsPage tree={tree.data} attachedEntries={attachedTrees} />
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </main>

      <OnboardingDialog
        open={dialogOpen}
        programs={list}
        forced={mustOnboard}
        initialYear={profile?.year}
        initialCode={profile?.code}
        initialMinors={profile?.minors}
        onSubmit={handleSubmit}
        onCancel={closeOnboarding}
        onImportTranscript={() => {
          closeOnboarding();
          openTranscriptImport();
        }}
      />
      <TranscriptImportDialog
        open={transcriptImportOpen}
        programs={list}
        onClose={closeTranscriptImport}
        onConfirm={handleTranscriptConfirm}
      />
      {/* 课程详情：由任意课程行的 ⓘ 触发，全局单例 */}
      <CourseDetailDialog />
      <Toaster />
    </div>
  );
}

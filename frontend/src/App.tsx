import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { FileText, GraduationCap, LayoutDashboard, ListChecks } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import type { NavItem } from "@/components/layout/SideNav";
import { OnboardingDialog } from "@/components/business/OnboardingDialog";
import { TranscriptImportDialog, type TranscriptImportResult } from "@/components/business/TranscriptImportDialog";
import { CourseDetailDialog } from "@/components/business/CourseDetailDialog";
import { EmptyState } from "@/components/ui/empty";
import { ErrorState } from "@/components/ui/error-state";
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

export default function App() {
  const programs = usePrograms();
  const {
    year,
    code,
    theme,
    setTheme,
    activeView,
    setProgram,
    onboardingOpen,
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

  // 刷新后 useUi 的选择会重置（非持久化）：profile 有效时用它校准
  useEffect(() => {
    if (programs.isLoading || list.length === 0) return;
    if (year && code) return;
    if (profile && list.some((p) => p.year === profile.year && p.code === profile.code)) {
      setProgram(profile.year, profile.code);
    }
  }, [programs.isLoading, list, year, code, profile, setProgram]);

  const mustOnboard = !programs.isLoading && needsOnboarding(profile, list);
  const dialogOpen = mustOnboard || onboardingOpen;

  // 侧栏计数徽标（与 OverviewPage 同源，计算成本可忽略）
  const audit = tree.data ? computeProgramAudit(tree.data.groups, selectionStatus) : null;
  const navItems: NavItem[] = [
    { key: "overview", label: "方案总览", icon: LayoutDashboard },
    {
      key: "courses",
      label: "课程选择",
      icon: ListChecks,
      count: audit?.missingCount ?? 0,
      countTone: "warning",
    },
    {
      key: "requirements",
      label: "要求明细",
      icon: FileText,
      count: tree.data?.groups.length ?? 0,
      countTone: "muted",
    },
  ];

  // 应用主题到 <html>（首屏由 index.html 的 inline 脚本抢先执行，这里只管后续变更）
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // 用户尚未手动选择时跟随系统主题变化；判断放在事件回调里，手动切换过就不再打扰
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("grad-theme");
      } catch {
        /* 读不到就当作未选择 */
      }
      if (saved === "light" || saved === "dark") return;
      setTheme(e.matches ? "dark" : "light", false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setTheme]);

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

  // 成绩单导入：已修以成绩单覆盖，手动勾选的计划保留
  const handleTranscriptConfirm = (r: TranscriptImportResult) => {
    setSelectionMany(r.courses);
    setProfileProgram(r.year, r.code, {
      admissionYear: r.admissionYear ?? null,
      school: schoolOf(r.code) || null,
    });
    useProfile.getState().setMinors(r.minors ?? []);
    setProgram(r.year, r.code);
    closeTranscriptImport();
    const taken = Object.values(r.courses).filter((s) => s === "taken").length;
    toast.success(`已导入 ${taken} 门已修 / ${Object.keys(r.courses).length - taken} 门在读计划`);
  };

  // 骨架与当前视图同构，避免加载完成时布局跳动
  const skeletonVariant =
    activeView === "courses"
      ? "courses"
      : activeView === "requirements"
        ? "requirements"
        : "overview";

  const renderContent = () => {
    if (programs.isLoading) return <PageSkeleton variant={skeletonVariant} />;
    if (programs.isError)
      return (
        <ErrorState
          title="无法加载培养方案列表"
          description="静态数据可能缺失或格式异常，请检查 frontend/public/data/ 是否随仓库一起发布"
          error={programs.error}
          onRetry={() => programs.refetch()}
        />
      );
    if (programs.data && programs.data.length === 0)
      return (
        <EmptyState
          icon={<GraduationCap className="mx-auto h-10 w-10 text-muted-foreground" />}
          title="还没有培养方案数据"
          description={
            <>
              静态数据由离线管线产物导出，请先生成：
              <br />
              <code className="font-mono text-xs">
                py -m run_pipeline --year 2026-27 --code COMP
              </code>
              <br />
              <code className="font-mono text-xs">python scripts/export_static_data.py</code>
            </>
          }
        />
      );
    if (!programs.data || programs.data.length === 0) return null;

    if (tree.isLoading) return <PageSkeleton variant={skeletonVariant} />;
    if (tree.isError)
      return (
        <ErrorState
          title="培养方案加载失败"
          error={tree.error}
          onRetry={() => tree.refetch()}
        />
      );
    if (!tree.data) return null;

    if (activeView === "overview")
      return (
        <OverviewPage
          tree={tree.data}
          attachedEntries={attachedTrees}
          onRemoveMinor={handleRemoveMinor}
        />
      );
    if (activeView === "courses")
      return <CoursesPage tree={tree.data} attachedEntries={attachedTrees} />;
    return <RequirementsPage tree={tree.data} attachedEntries={attachedTrees} />;
  };

  return (
    <>
      <AppShell programs={list} navItems={navItems}>
        {renderContent()}
      </AppShell>

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
    </>
  );
}

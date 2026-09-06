import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProgramPicker } from "@/components/business/ProgramPicker";
import { OverviewPage } from "@/pages/OverviewPage";
import { CoursesPage } from "@/pages/CoursesPage";
import { RequirementsPage } from "@/pages/RequirementsPage";
import { usePrograms, useProgramTree } from "@/hooks/queries";
import { useUi } from "@/stores/ui";
import { Moon, Sun, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function App() {
  const programs = usePrograms();
  const { year, code, theme, toggleTheme } = useUi();
  const tree = useProgramTree(year, code);

  // 应用主题到 <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

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
            {programs.data && programs.data.length > 0 && <ProgramPicker programs={programs.data} />}
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="切换主题">
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* 主内容（预留顶栏高度） */}
      <main className="mx-auto max-w-6xl px-4 pt-[72px] pb-16">
        {programs.isLoading && <Skeleton />}
        {programs.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
            无法加载培养方案列表：请确认后端服务已启动（uvicorn，端口 8000）。
            <br />
            <span className="text-muted-foreground">{String(programs.error)}</span>
          </div>
        )}

        {programs.data && programs.data.length === 0 && (
          <EmptyHint />
        )}

        {programs.data && programs.data.length > 0 && (
          <>
            {tree.isLoading && <Skeleton />}
            {tree.isError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
                加载培养方案失败：
                <span className="text-muted-foreground">{String(tree.error)}</span>
              </div>
            )}
            {tree.data && (
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">方案总览</TabsTrigger>
                  <TabsTrigger value="courses">课程选择</TabsTrigger>
                  <TabsTrigger value="requirements">要求明细</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <OverviewPage tree={tree.data} />
                </TabsContent>
                <TabsContent value="courses">
                  <CoursesPage tree={tree.data} />
                </TabsContent>
                <TabsContent value="requirements">
                  <RequirementsPage tree={tree.data} />
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse-soft">
      <div className="h-40 rounded-lg bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-lg border bg-card p-8 text-center space-y-2">
      <GraduationCap className="h-10 w-10 mx-auto text-muted-foreground" />
      <p className="font-medium">数据库中还没有培养方案</p>
      <p className="text-sm text-muted-foreground">
        请先运行离线管线解析 PDF 并用 seed 导入：
        <br />
        <code className="text-xs font-mono">py -m run_pipeline --year 2026-27 --code COMP</code>
        <br />
        <code className="text-xs font-mono">python backend/scripts/seed.py</code>
      </p>
    </div>
  );
}

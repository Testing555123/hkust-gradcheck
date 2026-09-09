import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { SideNav, type NavItem } from "@/components/layout/SideNav";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { TopBar } from "@/components/layout/TopBar";
import { Sheet } from "@/components/ui/sheet";
import { useUi } from "@/stores/ui";
import type { ProgramInfo } from "@/types";

interface AppShellProps {
  programs: ProgramInfo[];
  navItems: NavItem[];
  /** 侧栏「规划中」分组（为后续功能预留位置） */
  plannedItems?: { label: string }[];
  children: ReactNode;
}

const PLANNED = [{ label: "主修 + 辅修双进度" }, { label: "学期时间线" }];

/**
 * 应用外壳：顶栏（固定 56px）+ 桌面侧栏（md 以上常驻 240px）+ 内容区 + 移动底栏。
 * 小屏侧栏收进底部抽屉，由顶栏菜单按钮唤出；内容区用 padding 预留导航占位，避免遮挡。
 */
export function AppShell({
  programs,
  navItems,
  plannedItems = PLANNED,
  children,
}: AppShellProps) {
  const {
    year,
    code,
    theme,
    toggleTheme,
    openOnboarding,
    sidebarOpen,
    setSidebarOpen,
    sidebarCollapsed,
    toggleSidebarCollapsed,
  } = useUi();

  return (
    <div className="min-h-screen bg-background">
      <a href="#main-content" className="skip-link">
        跳转到主要内容
      </a>

      <TopBar
        programs={programs}
        year={year}
        code={code}
        theme={theme}
        onToggleTheme={toggleTheme}
        onEditProfile={openOnboarding}
        onOpenSidebar={() => setSidebarOpen(true)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebarCollapsed}
      />

      {/* 桌面侧栏：可折叠为图标条，宽度变化与内容区间距同步过渡 */}
      <aside
        id="app-sidebar"
        className={cn(
          "fixed bottom-0 left-0 top-14 hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-base motion-reduce:transition-none md:block",
          sidebarCollapsed ? "w-16" : "w-60"
        )}
      >
        <SideNav items={navItems} plannedItems={plannedItems} collapsed={sidebarCollapsed} />
      </aside>

      {/* 内容区：桌面让出侧栏宽度，移动预留底栏高度。
          水平 padding 必须放在内层容器：若留在 main 上，md:pl-60 会覆盖左侧 padding，
          导致「侧栏到内容 0px、内容到右缘 16px」的不对称，mx-auto 也补不回来。 */}
      <main
        id="main-content"
        className={cn(
          "pb-24 pt-14 transition-[padding] duration-base motion-reduce:transition-none md:pb-10",
          sidebarCollapsed ? "md:pl-16" : "md:pl-60"
        )}
      >
        <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 md:py-6">{children}</div>
      </main>

      <MobileTabBar items={navItems} className="md:hidden" />

      {/* 小屏侧栏抽屉 */}
      <Sheet
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        title="导航"
        description="切换视图或查看规划中的功能"
        className="md:hidden"
      >
        <SideNav
          items={navItems}
          plannedItems={plannedItems}
          onNavigate={() => setSidebarOpen(false)}
          className="px-1 py-2"
        />
      </Sheet>
    </div>
  );
}

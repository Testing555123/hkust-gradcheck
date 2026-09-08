import type { ReactNode } from "react";

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
  const { year, code, theme, toggleTheme, openOnboarding, sidebarOpen, setSidebarOpen } =
    useUi();

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
      />

      {/* 桌面侧栏 */}
      <aside className="fixed bottom-0 left-0 top-14 hidden w-60 border-r border-sidebar-border bg-sidebar md:block">
        <SideNav items={navItems} plannedItems={plannedItems} />
      </aside>

      {/* 内容区：桌面让出侧栏宽度，移动预留底栏高度 */}
      <main
        id="main-content"
        className="px-3 pb-24 pt-14 sm:px-4 md:pb-10 md:pl-60"
      >
        <div className="mx-auto max-w-6xl py-4 md:py-6">{children}</div>
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

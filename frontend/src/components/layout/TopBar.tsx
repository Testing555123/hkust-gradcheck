import { GraduationCap, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProgramPicker } from "@/components/business/ProgramPicker";
import { ProfileBadge } from "@/components/business/ProfileBadge";
import type { ProgramInfo } from "@/types";

interface TopBarProps {
  programs: ProgramInfo[];
  year: string;
  code: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onEditProfile: () => void;
  onOpenSidebar: () => void;
  /** 桌面侧栏折叠开关；小屏走抽屉，不使用 */
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

/**
 * 顶栏：Logo + 站名，右侧方案选择器 / 身份摘要 / 主题切换。
 * 吸顶并带毛玻璃；窄屏收起双下拉，改为菜单按钮打开侧栏抽屉。
 */
export function TopBar({
  programs,
  year,
  code,
  theme,
  onToggleTheme,
  onEditProfile,
  onOpenSidebar,
  sidebarCollapsed,
  onToggleSidebar,
}: TopBarProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 h-14 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center gap-2 px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onOpenSidebar}
          aria-label="打开导航菜单"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* 桌面：与移动菜单按钮同一个位置，按断点互斥显示 */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={onToggleSidebar}
          aria-controls="app-sidebar"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? "展开側邊導航" : "收起側邊導航"}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>

        <div className="flex min-w-0 items-center gap-2">
          <GraduationCap className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-sm font-semibold sm:text-base">
            畢業要求查詢與學分核查
          </h1>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {programs.length > 0 && (
            <div className="hidden lg:block">
              <ProgramPicker programs={programs} />
            </div>
          )}
          {year && code && (
            <ProfileBadge year={year} code={code} onClick={onEditProfile} />
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleTheme}
            aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </header>
  );
}

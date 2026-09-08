import { create } from "zustand";

export type AppView = "overview" | "courses" | "requirements";

interface UiState {
  year: string;
  code: string;
  setProgram: (year: string, code: string) => void;
  /**
   * 当前视图。刻意不引入客户端路由：静态托管已配置 SPA fallback，
   * 用状态切换可保持部署配置与页面挂载方式不变。
   */
  activeView: AppView;
  setView: (view: AppView) => void;
  /** 小屏侧栏抽屉开合（桌面侧栏常驻，不使用该状态） */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** 用户主动打开引导弹窗（顶栏摘要点击）；自动弹窗不经过这个状态 */
  onboardingOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  /** 成绩单导入弹窗（从引导弹窗进入） */
  transcriptImportOpen: boolean;
  openTranscriptImport: () => void;
  closeTranscriptImport: () => void;
  /** 课程详情弹窗：任意课程行都可触发，null 表示关闭 */
  courseCode: string | null;
  openCourse: (code: string) => void;
  closeCourse: () => void;
  /** 主题：light / dark。首屏由 index.html 的 inline 脚本同步应用，避免白闪 */
  theme: "light" | "dark";
  /** persist=false 用于跟随系统变化，不覆盖用户已做出的明确选择 */
  setTheme: (theme: "light" | "dark", persist?: boolean) => void;
  toggleTheme: () => void;
}

/** 用户已选择则用其选择，否则跟随系统 prefers-color-scheme */
function resolveInitialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("grad-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage 不可用时回退到系统偏好 */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useUi = create<UiState>()((set, get) => ({
  year: "",
  code: "",
  setProgram: (year, code) => set({ year, code }),
  activeView: "overview",
  setView: (view) => set({ activeView: view, sidebarOpen: false }),
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  onboardingOpen: false,
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false }),
  transcriptImportOpen: false,
  openTranscriptImport: () => set({ transcriptImportOpen: true }),
  closeTranscriptImport: () => set({ transcriptImportOpen: false }),
  courseCode: null,
  openCourse: (code) => set({ courseCode: code }),
  closeCourse: () => set({ courseCode: null }),
  theme: resolveInitialTheme(),
  setTheme: (next, persist = true) => {
    if (persist) {
      try {
        localStorage.setItem("grad-theme", next);
      } catch {
        /* 隐私模式下写入失败：仍允许切换，只是下次访问回到系统偏好 */
      }
    }
    set({ theme: next });
  },
  toggleTheme: () => {
    get().setTheme(get().theme === "light" ? "dark" : "light");
  },
}));

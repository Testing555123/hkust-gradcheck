import { create } from "zustand";

interface UiState {
  year: string;
  code: string;
  setProgram: (year: string, code: string) => void;
  /** 用户主动打开引导弹窗（顶栏摘要点击）；自动弹窗不经过这个状态 */
  onboardingOpen: boolean;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  /** 成绩单导入弹窗（从引导弹窗进入） */
  transcriptImportOpen: boolean;
  openTranscriptImport: () => void;
  closeTranscriptImport: () => void;
  /** 主题：light / dark；存 localStorage 由 App 应用到 <html> */
  theme: "light" | "dark";
  toggleTheme: () => void;
}

export const useUi = create<UiState>()((set, get) => ({
  year: "",
  code: "",
  setProgram: (year, code) => set({ year, code }),
  onboardingOpen: false,
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false }),
  transcriptImportOpen: false,
  openTranscriptImport: () => set({ transcriptImportOpen: true }),
  closeTranscriptImport: () => set({ transcriptImportOpen: false }),
  theme: (localStorage.getItem("grad-theme") as "light" | "dark") || "light",
  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    localStorage.setItem("grad-theme", next);
    set({ theme: next });
  },
}));

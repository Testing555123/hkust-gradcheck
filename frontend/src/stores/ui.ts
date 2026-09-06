import { create } from "zustand";

interface UiState {
  year: string;
  code: string;
  setProgram: (year: string, code: string) => void;
  /** 主题：light / dark；存 localStorage 由 App 应用到 <html> */
  theme: "light" | "dark";
  toggleTheme: () => void;
}

export const useUi = create<UiState>()((set, get) => ({
  year: "",
  code: "",
  setProgram: (year, code) => set({ year, code }),
  theme: (localStorage.getItem("grad-theme") as "light" | "dark") || "light",
  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    localStorage.setItem("grad-theme", next);
    set({ theme: next });
  },
}));

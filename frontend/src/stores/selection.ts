import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CourseStatus } from "@/types";

interface SelectionState {
  /** courseCode -> 已修 / 计划 */
  status: Record<string, CourseStatus>;
  /** 设置课程状态；再次点击同状态则取消（互斥切换） */
  toggle: (code: string, next: CourseStatus) => void;
  /** 批量写入（成绩单导入）：entries 中的课号以新值为准，其余课号不受影响 */
  setMany: (entries: Record<string, CourseStatus>) => void;
  clearAll: () => void;
}

export const useSelection = create<SelectionState>()(
  persist(
    (set) => ({
      status: {},
      toggle: (code, next) =>
        set((state) => {
          const status = { ...state.status };
          if (status[code] === next) {
            delete status[code];
          } else {
            status[code] = next;
          }
          return { status };
        }),
      setMany: (entries) =>
        set((state) => ({
          status: { ...state.status, ...entries },
        })),
      clearAll: () => set({ status: {} }),
    }),
    { name: "grad-selection-v1" }
  )
);

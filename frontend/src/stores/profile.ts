import { create } from "zustand";
import { persist } from "zustand/middleware";

import { emptyProfile, type Profile } from "@/lib/profile";

export interface ProfileExtras {
  /** 通识框架判定的入学学年（Admit Date 推导） */
  admissionYear?: string | null;
  /** 学院（通识 Home Area 判定）；缺省由 program 反查 */
  school?: string | null;
}

interface ProfileState {
  /** 用户入学信息；未选择过为 null */
  profile: Profile | null;
  /** 写入/更新主修（同时刷新 updatedAt；extra 提供通识引擎所需字段） */
  setProgram: (year: string, code: string, extra?: ProfileExtras) => void;
  /** 写入辅修 / Extended Major 多选（保留主修等其它字段） */
  setMinors: (minors: string[]) => void;
  /** 选择主修内部的互斥分支方向（Track / Option）；二级分支不传即清空 */
  setBranch: (branch: string | null, subBranch?: string | null) => void;
  /** 清空（重新选择时用） */
  clear: () => void;
}

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: null,
      setProgram: (year, code, extra) => {
        const prev = get().profile;
        // 换专业才清空分支：同一方案重选（如引导弹窗重选同一项）不应丢掉已选方向
        const sameProgram = prev?.year === year && prev?.code === code;
        set({
          profile: {
            year,
            code,
            school: extra?.school ?? prev?.school ?? null,
            admissionYear: extra?.admissionYear ?? prev?.admissionYear ?? null,
            minors: prev?.minors ?? [],
            branch: sameProgram ? (prev?.branch ?? null) : null,
            subBranch: sameProgram ? (prev?.subBranch ?? null) : null,
            updatedAt: new Date().toISOString(),
          },
        });
      },
      setMinors: (minors) => {
        const prev = get().profile;
        if (!prev) return;
        set({
          profile: { ...prev, minors, updatedAt: new Date().toISOString() },
        });
      },
      setBranch: (branch, subBranch = null) => {
        const prev = get().profile;
        if (!prev) return;
        set({
          profile: {
            ...prev,
            branch,
            // 一级分支没选时，二级分支无意义
            subBranch: branch ? subBranch : null,
            updatedAt: new Date().toISOString(),
          },
        });
      },
      clear: () => set({ profile: null }),
    }),
    {
      name: "grad-profile-v1",
      version: 3,
      // v1 → v2：补 admissionYear；v2 → v3：补 branch / subBranch（分支方向选择）
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<ProfileState>;
        const base = emptyProfile();
        return {
          profile: state.profile
            ? {
                ...base,
                ...state.profile,
                admissionYear: state.profile.admissionYear ?? null,
                minors: state.profile.minors ?? [],
                branch: state.profile.branch ?? null,
                subBranch: state.profile.subBranch ?? null,
              }
            : null,
        } as ProfileState;
      },
    }
  )
);

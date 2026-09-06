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
  /** 清空（重新选择时用） */
  clear: () => void;
}

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: null,
      setProgram: (year, code, extra) => {
        const prev = get().profile;
        set({
          profile: {
            year,
            code,
            school: extra?.school ?? prev?.school ?? null,
            admissionYear: extra?.admissionYear ?? prev?.admissionYear ?? null,
            minors: prev?.minors ?? [],
            updatedAt: new Date().toISOString(),
          },
        });
      },
      clear: () => set({ profile: null }),
    }),
    {
      name: "grad-profile-v1",
      version: 2,
      // v1 → v2：补 admissionYear 字段（v1 无此概念，置空）
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
              }
            : null,
        } as ProfileState;
      },
    }
  )
);

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { emptyProfile, type Profile } from "@/lib/profile";

interface ProfileState {
  /** 用户入学信息；未选择过为 null */
  profile: Profile | null;
  /** 写入/更新主修（同时刷新 updatedAt） */
  setProgram: (year: string, code: string) => void;
  /** 清空（重新选择时用） */
  clear: () => void;
}

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: null,
      setProgram: (year, code) => {
        const prev = get().profile;
        set({
          profile: {
            year,
            code,
            // 学院 / 辅修数据尚未接入，保留字段位但恒为空
            school: prev?.school ?? null,
            minors: prev?.minors ?? [],
            updatedAt: new Date().toISOString(),
          },
        });
      },
      clear: () => set({ profile: null }),
    }),
    {
      name: "grad-profile-v1",
      version: 1,
      // 预留迁移：将来补充学院 / 辅修等字段时按 version 平滑升级
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<ProfileState>;
        const base = emptyProfile();
        return {
          profile: state.profile
            ? { ...base, ...state.profile, minors: state.profile.minors ?? [] }
            : null,
        } as ProfileState;
      },
    }
  )
);

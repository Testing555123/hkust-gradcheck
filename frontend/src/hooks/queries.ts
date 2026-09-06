import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MOCK_PROGRAMS, mockTreeFor } from "@/mocks/programs";
import type { ProgramInfo, ProgramTreeData } from "@/types";

/** 开发期开关：frontend/.env.local 里 VITE_USE_MOCK=1 时走假数据，不请求后端 */
const USE_MOCK =
  import.meta.env.VITE_USE_MOCK === "1" || import.meta.env.VITE_USE_MOCK === "true";

export function usePrograms() {
  return useQuery({
    queryKey: ["programs"],
    queryFn: async (): Promise<ProgramInfo[]> => {
      if (USE_MOCK) return MOCK_PROGRAMS;
      const { data, error } = await api.GET("/api/programs");
      if (error) throw new Error("无法加载培养方案列表");
      return data ?? [];
    },
  });
}

export function useProgramTree(year: string, code: string) {
  return useQuery({
    queryKey: ["program-tree", year, code],
    enabled: Boolean(year && code),
    // 数据由离线管线 + seed 更新，前端始终拉取最新树，避免旧缓存导致"课程缺失"错觉
    staleTime: 0,
    queryFn: async (): Promise<ProgramTreeData> => {
      if (USE_MOCK) {
        const tree = mockTreeFor(year, code);
        if (!tree) throw new Error(`无法加载 ${year} ${code} 的培养方案`);
        return tree;
      }
      const { data, error } = await api.GET("/api/programs/{year}/{code}", {
        params: { path: { year, code } },
      });
      if (error) throw new Error(`无法加载 ${year} ${code} 的培养方案`);
      return data;
    },
  });
}

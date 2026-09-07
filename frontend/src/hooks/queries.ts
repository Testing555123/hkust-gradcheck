import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MOCK_PROGRAMS, mockTreeFor } from "@/mocks/programs";
import type { AttachedProgram } from "@/lib/attached";
import type { ProgramInfo, ProgramTreeData } from "@/types";

/** 开发期开关：frontend/.env.local 里 VITE_USE_MOCK=1 时走假数据，不请求后端 */
const USE_MOCK =
  import.meta.env.VITE_USE_MOCK === "1" || import.meta.env.VITE_USE_MOCK === "true";

function fetchTree(year: string, code: string): Promise<ProgramTreeData> {
  if (USE_MOCK) {
    const tree = mockTreeFor(year, code);
    if (!tree) throw new Error(`无法加载 ${year} ${code} 的培养方案`);
    return Promise.resolve(tree);
  }
  const call = api.GET("/api/programs/{year}/{code}", {
    params: { path: { year, code } },
  });
  return call.then(({ data, error }) => {
    if (error) throw new Error(`无法加载 ${year} ${code} 的培养方案`);
    return data;
  });
}

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
    queryFn: () => fetchTree(year, code),
  });
}

/** 附加方案（辅修/学院要求/EXTM）树加载结果 */
export interface AttachedTreeEntry {
  attached: AttachedProgram;
  tree?: ProgramTreeData;
  isLoading: boolean;
  isError: boolean;
}

/** 并行加载全部可用附加方案的树（不可用的直接标记降级，不发请求） */
export function useAttachedTrees(entries: AttachedProgram[]): AttachedTreeEntry[] {
  const usable = entries.filter((e) => e.available);

  const queries = useQueries({
    queries: usable.map((e) => ({
      queryKey: ["program-tree", e.year, e.code],
      enabled: Boolean(e.year && e.code),
      staleTime: 0,
      queryFn: () => fetchTree(e.year, e.code),
    })),
  });

  return entries.map((e) => {
    const idx = usable.indexOf(e);
    if (idx === -1) {
      return { attached: e, isLoading: false, isError: false };
    }
    const q = queries[idx];
    return {
      attached: e,
      tree: q.data,
      isLoading: q.isLoading,
      isError: q.isError,
    };
  });
}

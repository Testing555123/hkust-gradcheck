import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchCourseIndex,
  fetchCourses,
  fetchProgramIndex,
  fetchProgramTree,
} from "@/lib/static-data";
import { MOCK_PROGRAMS, mockTreeFor } from "@/mocks/programs";
import type { AttachedProgram } from "@/lib/attached";
import type {
  CourseDetail,
  CourseIndexEntry,
  ProgramInfo,
  ProgramTreeData,
} from "@/types";

/** 开发期开关：frontend/.env.local 里 VITE_USE_MOCK=1 时走假数据，不读静态文件 */
const USE_MOCK =
  import.meta.env.VITE_USE_MOCK === "1" || import.meta.env.VITE_USE_MOCK === "true";

/**
 * 静态资源内容不可变（随构建产物一起发布），故 staleTime 设为 Infinity：
 * 切换 Tab / 反复开关弹窗不会重复发请求。
 */
const IMMUTABLE = { staleTime: Infinity, gcTime: Infinity } as const;

function fetchTree(year: string, code: string): Promise<ProgramTreeData> {
  if (USE_MOCK) {
    const tree = mockTreeFor(year, code);
    if (!tree) throw new Error(`无法加载 ${year} ${code} 的培养方案`);
    return Promise.resolve(tree);
  }
  return fetchProgramTree(year, code).catch(() => {
    throw new Error(`无法加载 ${year} ${code} 的培养方案`);
  });
}

export function usePrograms() {
  return useQuery({
    queryKey: ["programs"],
    ...IMMUTABLE,
    queryFn: async (): Promise<ProgramInfo[]> => {
      if (USE_MOCK) return MOCK_PROGRAMS;
      return fetchProgramIndex();
    },
  });
}

export function useProgramTree(year: string, code: string) {
  return useQuery({
    queryKey: ["program-tree", year, code],
    enabled: Boolean(year && code),
    ...IMMUTABLE,
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
      ...IMMUTABLE,
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

/**
 * 课程详情 + 反向索引：只在传入 code 时才发起请求（课程表与索引都接近 1MB），
 * 首次打开课程详情后即被缓存，后续点开任何课程都不再产生网络请求。
 */
export function useCourseLookup(code: string | null) {
  const enabled = Boolean(code);

  const courses = useQuery({
    queryKey: ["courses"],
    enabled,
    ...IMMUTABLE,
    queryFn: fetchCourses,
  });

  const index = useQuery({
    queryKey: ["course-index"],
    enabled,
    ...IMMUTABLE,
    queryFn: fetchCourseIndex,
  });

  const wanted = (code ?? "").toUpperCase();
  const detail: CourseDetail | undefined = courses.data?.find((c) => c.code === wanted);
  const bucket = index.data?.[wanted];

  return {
    detail,
    /** 该课被哪些方案引用（最多 50 条） */
    references: bucket?.items ?? ([] as CourseIndexEntry[]),
    /** 真实引用总数（可能大于 references.length） */
    referenceTotal: bucket?.total ?? 0,
    isLoading: enabled && (courses.isLoading || index.isLoading),
    isError: courses.isError || index.isError,
    /** courses.db 中查不到该课（例如 LLM 抽取出的占位课号） */
    missing: enabled && !courses.isLoading && !detail,
  };
}

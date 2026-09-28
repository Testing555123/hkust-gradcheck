/**
 * 数据源：两种形态，形状完全一致，因此上层 queries.ts 与所有核算逻辑无需改动。
 *
 * - `static`（默认）：读 scripts/export_static_data.py 预生成的 public/data/。
 *   生产（Vercel）与本地 dev 读同一份文件，不存在「本地能跑、线上缺数据」的漂移。
 * - `api`：读同一容器里的 /api/site/*（Payload + DB）。
 *
 * 两者并存是刻意的：并行对拍（裁决 C3）要求旧路径随时可用，
 * 新链路出问题时把 VITE_DATA_SOURCE 改回 static 即可回退，不必回滚代码。
 */

import type {
  CourseDetail,
  CourseIndex,
  ProgramInfo,
  ProgramTreeData,
} from "@/types";

/** 站点基址：默认 "/"，部署到子路径时由 Vite 的 BASE_URL 注入 */
const BASE = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const SOURCE = import.meta.env.VITE_DATA_SOURCE ?? "static";

export function dataUrl(path: string): string {
  if (SOURCE !== "api") return `${BASE}data/${path}`;
  // API 形态：静态文件名 -> 端点。program 树需要拆出 year/code。
  if (path === "index.json") return `${BASE}api/site/index`;
  if (path === "courses.json") return `${BASE}api/site/courses`;
  if (path === "course_index.json") return `${BASE}api/site/course-index`;
  const tree = path.match(/^programs\/(.+)_(.+)\.json$/);
  if (tree) return `${BASE}api/site/program/${tree[1]}/${tree[2]}`;
  throw new Error(`未知的数据路径形态：${path}`);
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path));
  if (!res.ok) {
    throw new Error(`加载数据失败（HTTP ${res.status}）：${path}`);
  }
  return (await res.json()) as T;
}

/** 255 条培养方案元信息（首屏唯一请求，约 64KB） */
export function fetchProgramIndex(): Promise<ProgramInfo[]> {
  return fetchJson<ProgramInfo[]>("index.json");
}

/** 单份完整要求树（选中后按需加载） */
export function fetchProgramTree(year: string, code: string): Promise<ProgramTreeData> {
  return fetchJson<ProgramTreeData>(`programs/${year}_${code}.json`);
}

/** 官方课程库 1144 门课（首次查看课程详情时懒加载，约 181KB） */
export function fetchCourses(): Promise<CourseDetail[]> {
  return fetchJson<CourseDetail[]>("courses.json");
}

/** 课程反向索引（首次查看课程详情时懒加载，约 1MB） */
export function fetchCourseIndex(): Promise<CourseIndex> {
  return fetchJson<CourseIndex>("course_index.json");
}

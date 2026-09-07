/**
 * 静态数据源：所有数据由 scripts/export_static_data.py 在构建前预生成到 public/data/。
 *
 * 生产（Cloudflare Pages）与本地 dev（Vite 直接托管 public/）读的是同一份文件，
 * 因此不存在「本地能跑、线上缺数据」的漂移。
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

export function dataUrl(path: string): string {
  return `${BASE}data/${path}`;
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

import createClient from "openapi-fetch";
import type { paths } from "@/api/generated/schema";

// 生成的 paths 已包含 /api 前缀（后端路由前缀），故 baseUrl 用根路径；
// 开发时由 Vite proxy 把 /api 转发到 127.0.0.1:8000。
export const api = createClient<paths>({ baseUrl: "" });

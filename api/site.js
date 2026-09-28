// Vercel Serverless Function — 代理 /api/site/* 到 newone-studio（Payload + Neon）。
// 浏览器视其为同源请求，无需 CORS；vercel.json 已不再使用外部 rewrite（Vercel 实测不生效），
// 改由本函数做同源透传。
//
// 为什么是「扁平文件 + query 传参」而不是 `api/site/[...path].js`：
//   实测本项目里带方括号的 catch-all 文件虽被编译，却**没有被 Vercel 注册成路由**
//   （/api/site/index 返回 `Route not found "/api/site"`），而同目录下的扁平函数（/api/ping）正常 200。
//   故改为：vercel.json 用 rewrite 把 /api/site/(.*) 重写到 /api/site?path=$1，
//   由本函数按 query 中的 path 转发。全程无方括号文件名，行为与原来的 catch-all 等价。
const STUDIO = "https://newone-studio.vercel.app";

export default async function handler(req, res) {
  const raw = req.query.path;
  const path = Array.isArray(raw) ? raw.join("/") : (raw || "");
  const url = `${STUDIO}/api/site/${path}`;
  try {
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await upstream.text();
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    // 与静态数据一致的短缓存策略
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    res.status(upstream.status);
    res.send(body);
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.status(502).send(JSON.stringify({ error: "studio proxy failed: " + e.message }));
  }
}

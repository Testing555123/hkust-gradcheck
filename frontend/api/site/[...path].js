// Vercel Serverless Function — 代理 /api/site/* 到 newone-studio（Payload + Neon）。
// 放在 frontend/api/ 以覆盖 newone-web Root Directory = frontend/ 的情况。
// 浏览器视其为同源请求，无需 CORS；绕开 vercel.json 对外部域名的 rewrite（本项目未生效）。
const STUDIO = "https://newone-studio.vercel.app";

export default async function handler(req, res) {
  const seg = req.query.path;
  const path = Array.isArray(seg) ? seg.join("/") : (seg || "");
  const qs = req.url && req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const url = `${STUDIO}/api/site/${path}${qs}`;
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

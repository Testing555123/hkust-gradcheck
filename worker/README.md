# grad-worker（Cloudflare Workers 部署单元）

FastAPI + D1 版后端，与 `backend/`（本地 uvicorn + SQLite 文件版）端点行为一致。

一次性设置、部署与本地验证步骤见仓库根 `README.md` 的「公网部署（Cloudflare Workers + D1）」章节。

```bash
# 本地数据层单测（Fake D1，无需 workers 运行时）
.venv/bin/python -m pytest worker/tests -q

# 本地 Workers 运行时（需 macOS 13.5+ / Linux）
npx wrangler d1 execute grad-db --local --file db_init.sql
npx wrangler dev
```

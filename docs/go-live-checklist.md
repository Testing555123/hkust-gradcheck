# 上線檢核表（Go-Live Checklist）

分支：`feat/deploy-vercel-neon`
最近提交：`12895c9` — chore(deploy): migrate studio/frontend to Vercel + Neon; add worker & agent pipeline

> 本表用於「代碼已就緒、部署前最後確認」階段。標記 ☐ 的項目需在**能連線 Vercel / Neon 的環境**實際執行並確認結果；本機無法代為驗證。

---

## ✅ A. 本地已證實（代碼/配置層面）

- [x] 分支已推送並與 `origin/feat/deploy-vercel-neon` 完全同步（0 ahead / 0 behind），工作區乾淨。
- [x] 學生端靜態兜底完整：`frontend/public/data` 含 259 個 JSON（255 份方案 + 索引），`static-data.ts` 預設 `VITE_DATA_SOURCE=static` —— 即使 API/DB 全掛，學生端仍能瀏覽全部方案。
- [x] Studio 遷移就緒：`migrations/20260928_170856_source_chunks.ts` 與 init 遷移存在；`next.config.ts` 已移除 `output:'standalone'`（修掉 Vercel + Turbopack 構建失敗）。
- [x] API 契約完整：`/api/site/{index|course-index|courses|program/<year>/<code>}` 四類唯讀端點，免登入讀取已開放，與靜態 JSON 同構。
- [x] 反代配置正確：`vercel.json` 將學生端 `/api/site/*` 同域反代到 studio（免 CORS），`buildCommand`/`outputDirectory` 正確。
- [x] 無密鑰外洩：`.env` 已 gitignore，`DATABASE_URL` / `PAYLOAD_SECRET` 未出現在代碼中。

---

## ⚠️ B. 必須線上驗證（在能連 Vercel / Neon 的網路執行）

- [ ] **B1 — Neon 資料庫已灌滿**
  執行 studio 的 `npm run db:init`，確認數量：
  `programs = 255` / `courses = 1144` / `course_refs = 1344` / `metas = 3` / `derived = 255`。
  （部署手冊聲稱已做，但未實際連庫確認。）

- [ ] **B2 — Studio 線上 API 對齊**
  在能連 Vercel 的環境執行：
  `node scripts/check_site_parity.mjs https://newone-studio.vercel.app`
  期望結果：`258 / 258`（與靜態 JSON 對齊）。

- [ ] **B3 — `vercel.json` 反代目標正確**
  確認硬編碼的 `newone-studio.vercel.app` **就是 studio 實際生產域名**。
  若 studio 專案名 / 域名不同，學生端即時 API 會全掛（但靜態回退仍可用）。

- [ ] **B4 — `newone-web` 資料源開關**
  確認 `newone-web` 專案的環境變數 `VITE_DATA_SOURCE=api` 已設。
  若未設，學生端會走靜態回退（非即時），不影響瀏覽但非預期行為。

- [ ] **B5 — 兩專案環境變數已注入**
  確認 `newone-studio` 已部署，且 `DATABASE_URL` + `PAYLOAD_SECRET` 已注入 Vercel 專案設定。

---

## ❌ C. 已知限制（不應誤判為「改完即生效」）

- [ ] **C1 — `source → derived` 重算（T9）未做**
  在 admin 改 `source` 不會重算 `derived`，API 仍回傳舊 `derived`。
  要更新數據須重跑烘焙 + `npm run db:ingest`。

- [ ] **C2 — CI / 自動部署未接好**
  `ci.yml` 仍是舊的 Cloudflare 描述，且只在 `main` / `pull_request` 觸發 —— 本分支**不會自動跑 `npm run verify` 門禁**。
  `git push` 自動雙部署需 Dashboard 授權，可能未接。

- [ ] **C3 — 本地 `npm run verify` 全鏈未實跑**
  本機無 `node_modules` / `.venv`，無法當場證明構建與測試全綠。
  建議在能連網環境安裝依賴並實跑一次 `npm run verify`（含 `build:studio`）。

---

## 📋 上線前最後確認順序

1. 連得通 Vercel 的環境跑 `check_site_parity` → 期望 `258/258`（B2）。
2. 確認 `newone-studio` 已部署、`DATABASE_URL` + `PAYLOAD_SECRET` 已注入、`db:init` 已執行（B1 / B5）。
3. 確認 `newone-web` 的 `VITE_DATA_SOURCE=api` 已設（B4）。
4. 確認 `vercel.json` 反代目標域名正確（B3）。
5. 合併 `main` 前，把 CI 更新為跑 `npm run verify`（含 `build:studio`），或在 PR 上先手跑一次（C2 / C3）。

---

## 🗂 本次提交收錄範圍（12895c9）

- **A 組（已修改追蹤檔）**：README、docs 部署手冊/決策、studio 後端配置、frontend 資料源、`package*.json`、`vercel.json`、pipeline 腳本。
- **B 組（確認刪除）**：Atlas 同步腳本/CI、前端舊 API/Cloudflare 配置、舊 studio API 入口、舊設計文件。
- **C 組（新功能）**：`api/site.js`、studio `source-chunks` 集合 + ingest-agent + 遷移、`apps/worker/`、`pipeline/agents/`、`pipeline/extract_b.py`、`pipeline/grounding.py`、`pipeline/tests/`。
- **已排除（未進庫）**：`logs/agent-2026-09-28.jsonl`、`pipeline/output/agent/`（數百個生成 JSON，可由管線重跑產生）。

# 架構重構設計：前後端完全分離（Nuxt3 + NestJS + MongoDB Atlas）

- **日期**：2026-09-15
- **狀態**：設計已確認，待 user review 後轉實作計畫
- **範圍**：全量重寫，不保留現有 React 靜態站
- **產出**：本文件（spec）→ 實作計畫（writing-plans）→ 分期落地

---

## 1. 背景與現況

現行系統是「純靜態 + 離線管線」架構：

| 層 | 現況 |
|----|------|
| 前端 | React 18 + Vite + shadcn/ui 靜態站（三視圖），部署於 Cloudflare Pages；勾選狀態存 localStorage（三個 zustand store） |
| 資料 | 建置前固化的靜態 JSON（`frontend/public/data/`：255 份方案樹 + 1144 門課程 + 反向索引），隨 git 入庫 |
| 管線 | Python：MinerU 解析（`mineru_api` / `mineru_local` / `pymupdf` 三後端）→ LLM 結構化抽取 → 分支標記 → 學分 crosscheck → 導出靜態 JSON |
| 領域規則 | 分支（Track/Option，77 份方案）、開放式層級池（43 組）、OR/AND 組合（600 組，含兩套語法族）、通識 30 學分判定 —— 目前全在前端純函式（112 條 vitest）與 Python（28 條 pytest） |
| 資料權威 | `pipeline/output/*.json`（255 份，人工校對）+ `courses.db`（SQLite）；CI 靠「重跑導出後 git diff 必須為空」把關 |

**問題**：無後端、無使用者狀態、人工校對靠改 JSON + git commit、資料更新需重新部署。

**目標**：前後端完全分離的現代化系統 —— Nuxt3 只做呈現，NestJS 承載業務邏輯，MongoDB Atlas 為唯一資料權威，全流程容器化並部署於 Vercel。

---

## 2. 目標與非目標

### 目標

1. 前後端完全分離：前端不直連資料庫、不內嵌業務規則；後端是唯一業務入口。
2. 完整資料流落地：爬蟲 → MinerU 解析 → LLM 結構化 → 領域規則 → 校驗 → MongoDB Atlas → API → Nuxt UI。
3. MongoDB 為唯一資料權威，管理員在後台完成校對（取代改 JSON + commit）。
4. 容器化 + Vercel 部署，具備可擴展性、可維護性與部署一致性。
5. 現有能力 1:1 平移（分兩期），領域規則**移植**而非重猜。

### 非目標

- 不做多階段審批流（草稿 → 審核 → 發布）；改為「即時生效 + 完整審計 + 可回滾」。
- 不做使用者註冊/登入（僅匿名 session + 管理員帳號）。
- 不保留舊 React 站點、不保留舊 Python 管線（遷移後歸檔）。
- 不引入 Docker Compose 作為部署形態（僅本地開發與 CI e2e 使用）。

---

## 3. 決策記錄

| # | 決策 | 選定 | 理由 / 被否決的選項 |
|---|------|------|---------------------|
| D1 | 交付範圍 | 全量重寫 | 使用者選擇；接受期間站點不可用 |
| D2 | 身份模型 | 匿名 session + 管理員帳號 | 一般使用者免註冊；管理員可管帳號與資料。否決：完整帳號體系（過重） |
| D3 | 資料權威 | MongoDB 唯一權威 | 管線與後台都寫 Mongo，文件帶審計欄位。否決：git JSON 為權威（雙寫漂移） |
| D4 | 部署拓撲 | Vercel 容器（`services` 多服務） | **Vercel 自 2025-11 支援 OCI 容器、2026-07 支援任意 `Dockerfile`**；官方替代 Compose 的是 `vercel.json` 的 `services` + `rewrites` |
| D5 | 批處理執行層 | GitHub Actions 定時任務 | 爬蟲與 PDF 管線長時、吃記憶體，Vercel 容器為無狀態 Function（300s/800s、無常駐）。否決：Vercel Cron 分片（時長與 4.5 MB 風險） |
| D6 | 管線命運 | 重寫為 TS（`apps/worker`） | 統一語言與型別；解析層仍用 MinerU |
| D7 | 解析服務 | **MinerU 線上 API**（唯一後端） | 保留既有解析品質；`mineru_local` / `pymupdf` 降級下線 |
| D8 | 前端功能 | 1:1 平移、分兩期 | 一期：瀏覽 + 勾選 + 進度 + 要求明細；二期：成績單 / 通識 / 附加方案 |
| D9 | 倉庫拓撲 | pnpm monorepo + 共享套件 | 契約與領域邏輯單一來源；否決：雙倉（契約複製漂移）、Nest 託管 Nuxt（違背分離目標） |
| D10 | 原始 PDF 存儲 | **不存，只存 sha256** | 最省存儲；代價是每次重跑重新下載並重付解析費（以增量 + CI 快取對沖） |
| D11 | 核算口徑 | 前端樂觀（共享 domain 純函式）+ 後端 `/session/audit` 權威對帳 | 兼顧零延遲互動與口徑一致 |

---

## 4. 總體架構

### 4.1 三個應用（獨立部署單元）

| 應用 | 職責 | 部署 | 對外 |
|------|------|------|------|
| `apps/web` | Nuxt3 + NuxtUI + Vite，只做呈現：SSR 首屏、路由、互動、即時反饋 | Vercel（`Dockerfile.vercel`） | 瀏覽器 |
| `apps/api` | NestJS：資料查詢、學分核算、匿名 session、管理員認證與後台 API | Vercel（`Dockerfile.vercel`，`/api/*` rewrite） | 瀏覽器 / 後台 |
| `apps/worker` | TS 管線 CLI：crawl → parse → extract → rules → verify → ingest；**不開 HTTP** | GitHub Actions | 無 |

### 4.2 四個共享套件（依賴單向）

```
contracts ← domain ← (web / api / worker)
                    ↑
      mongo, mineru-client（僅 api / worker 使用）
```

| 套件 | 內容 | 使用者 |
|------|------|--------|
| `packages/contracts` | 唯一契約源：Zod schema（Program / Group / Course / Combo / Audit / DTO）+ 錯誤碼枚舉；由它生成 OpenAPI 與前端型別 | 全部 |
| `packages/domain` | 純函式領域邏輯：學分核算、OR/AND 組合折疊、分支過濾、通識判定、層級池展開（現有 112 條前端測試搬入續用） | web + api + worker |
| `packages/mongo` | 集合定義、索引、migration、repository 基底 | api + worker |
| `packages/mineru-client` | MinerU 線上 API 四步調用封裝 + 可插拔 Parser 介面 | worker |

### 4.3 邊界紀律

1. `apps/web` **永不直連 Mongo、不自行實作業務規則**：規則的唯一定義與維護處在 `packages/domain`；web 只 import 該套件的純函式做即時樂觀反饋（同一份程式碼，非前端另寫一套），最終口徑仍以 API 為準。
2. `apps/api` **永不接觸 MinerU / 爬蟲**：管線依賴只裝進 worker 鏡像（Vercel 函式體積 250 MB 上限）。
3. `apps/worker` **不開服務**：冪等 CLI，相同輸入重跑不產生重複資料（upsert + `ingestRuns` 記錄）。

### 4.4 目錄結構

```
repo/
├─ apps/
│  ├─ web/                 Nuxt3 + NuxtUI + Vite
│  │  ├─ pages/            index / programs / requirements / admin
│  │  ├─ components/       UI 元件（純呈現）
│  │  ├─ composables/      useApi / useSession / useAudit / 錯誤處理
│  │  └─ Dockerfile.vercel
│  ├─ api/                 NestJS
│  │  ├─ src/modules/      programs / courses / session / auth / admin / health
│  │  ├─ src/common/       守衛、攔截器、錯誤過濾器、審計
│  │  └─ Dockerfile.vercel
│  └─ worker/              TS 管線 CLI
│     ├─ src/stages/       crawl / parse / extract / rules / verify / ingest
│     ├─ src/parsers/      mineru-api.ts（介面預留第二實現）
│     └─ src/commands/     run / migrate-legacy / verify-only
├─ packages/
│  ├─ contracts/  domain/  mongo/  mineru-client/
├─ infra/
│  ├─ vercel.json          services + rewrites
│  ├─ docker/compose.dev.yml
│  └─ gh-actions/          cron-crawl.yml / pipeline-run.yml / verify-golden.yml
├─ docs/                   ADR 與資料字典
└─ pnpm-workspace.yaml / turbo.json
```

---

## 5. 資料模型（MongoDB Atlas）

### 5.1 集合

| 集合 | 內容 | 索引 | 生命週期 |
|------|------|------|----------|
| `programs` | 255 份方案，**整棵要求樹內嵌**（groups → courses → combos / branch / pool / note） | unique `{year, code}`；`{code}`、`{hasBranches}`、`{revision}` | 管線 upsert；管理員可編輯 |
| `courses` | 1144 門課程庫（正規化） | unique `{code}`；`{subject}` | 爬蟲/匯入更新 |
| `courseRefs` | 反查索引物化：課號 → 被哪些方案/組引用（等價現 1 MB `course_index.json`） | `{courseCode}`；`{year, code}` | ingest 階段全量重建 |
| `sessions` | 匿名 session：`selection`、`profile`、`admissionYear` | unique `{sessionId}`；TTL `{expiresAt}`（90 天） | 訪問滑動續期 |
| `adminUsers` | email、passwordHash（argon2）、role（admin/editor）、lastLoginAt | unique `{email}` | 管理員管理 |
| `auditLogs` | append-only：actor、action、collection、docId、before/after、at、ip | `{at:-1}`、`{actorId}`、`{docId}` | 永久保留 |
| `validationIssues` | 學分不符 / 缺課 / 組合句式未識別 / 管線衝突 | `{year, code, type, resolved}` | 每次 ingest 重建 |
| `ingestRuns` | stage、來源、狀態、統計（頁數 / LLM tokens / 耗時 / 成本）、錯誤 | `{startedAt:-1}`、`{stage, status}` | 永久保留 |
| `commonCoreMap` | 通識課程映射（現 73 KB 前端 JSON） | `{admissionYear}` | 管線 / 管理員維護 |

### 5.2 內嵌 vs 正規化的取捨

- **方案樹內嵌**：單份 30–70 KB ≪ 16 MB 上限；一次查詢取回完整樹，與現有 JSON 形狀一致（前端型別幾乎不改）；255 份合計約 10 MB，可整庫快取。
- **課程正規化**：課程需跨方案反查、被 worker 更新、被單獨取詳情；內嵌會導致 255 份文檔全量重寫。
- **反查索引物化**：內嵌欄位無法高效反查（需 `$unwind` 全庫掃描），故在 ingest 最後一步重建 `courseRefs`，把成本壓在離線。

### 5.3 審計與版本

```jsonc
{
  "year": "2024-25", "code": "MATH", "revision": 7,
  "provenance": {
    "crawlRunId": "...", "parseRunId": "...", "extractRunId": "...",
    "parser": "mineru-api", "llmModel": "gpt-4o-mini",
    "sourcePdf": { "url": "...", "sha256": "...", "pages": 12 }
  },
  "updatedAt": "...", "updatedBy": { "type": "admin" | "worker", "id": "..." },
  "groups": [ /* 內嵌要求樹，含 combos / branch / pool */ ]
}
```

管理員編輯：`revision++` + 寫 `auditLogs`（字段級 before/after）。**不做審批流**，靠 revision + 審計做回滾。

### 5.4 管線與管理員的併發衝突保護

1. 管線寫入前比對 `lastPipelineHash` 與當前文檔；
2. 若管理員在期間改過（`updatedBy.type === "admin"`）→ **不覆蓋**，產生 `validationIssue: {type: "pipeline_conflict"}`，把「新抽取結果 vs 現行內容」並列供後台決策（採用 / 保留 / 合併）；
3. 管理員採用後 `revision++` 並寫審計。

---

## 6. 資料流與批處理編排

### 6.1 六階段（`apps/worker`，逐步冪等、可斷點續跑）

```
[1 crawl] → [2 parse] → [3 extract] → [4 rules] → [5 verify] → [6 ingest] → Atlas → API → Nuxt
```

| 階段 | 內容 | 產出 | 冪等鍵 |
|------|------|------|--------|
| 1 crawl | 抓 HKUST unpress 方案清單與 PDF（新建：fetch + 有限併發 + 退避重試 + 限速 + 標識 UA），只下載新增或 sha256 變更者 | `crawlIndex[]` | `{year, code, sha256}` |
| 2 parse | MinerU 線上 API 四步流程（申請上傳連結 → PUT 預簽名 → 輪詢 `extract-results` → 下載 zip 取 `*.md` + `*_content_list.json`），封裝為可插拔 `Parser` | `ParsedDocument`（頁碼標記全文） | `{year, fileStem, parserVersion}`（**學年必須入鍵**，跨學年檔名相同） |
| 3 extract | LLM 結構化抽取：帶頁碼全文 + Zod schema + JSON mode，每項必帶 `source_pages`；失敗帶錯誤詳情 repair 重試；429 退避 + 模型池輪換 | 抽取 JSON | `{year, code, sha256, modelId}` |
| 4 rules | **領域規則移植**：分支標記、層級池偵測、OR/AND 組合解析（兩套語法族）、`provenance` | 完整方案文檔 | `{year, code, sha256, rulesVersion}` |
| 5 verify | Schema 驗證 + 學分交叉核對（vs `courses`）+ golden diff（對比 255 份現有產物） | `validationIssues[]` + 差異報告 | 每次重建 |
| 6 ingest | 冪等 upsert Atlas；重建 `courseRefs`；寫 `ingestRuns` 與 worker 審計 | Mongo 文檔 | `{year, code, revision}` |

### 6.2 GitHub Actions 編排

| Workflow | 觸發 | 內容 |
|----------|------|------|
| `cron-crawl.yml` | 每日 03:00（可配） | 階段 1；sha256 有變更則 dispatch 管線（帶目標清單） |
| `pipeline-run.yml` | dispatch / 手動（`--year --code` 或 `--all`） | 分片矩陣（每 job 處理 N 份方案，避免 6 小時上限）；階段 2→6 串行；失敗重試 1 次後記入 `ingestRuns` 並續跑其餘 |
| `verify-golden.yml` | PR / 手動 | 255 份產物 golden 比對，驗證規則移植無回歸 |

Secrets：`MINERU_API_TOKEN`、`GRAD_LLM_API_KEY/BASE_URL/MODEL(S)`、`MONGODB_URI`。

### 6.3 不存 PDF 的對沖

- **增量**：`cron-crawl` 只下載新增/變更；學年無變化則整條管線 `noop`。
- **CI 快取**：`actions/cache` 以 `sha256 + parserVersion` 快取 **MinerU 產物**（不含 PDF 本體）。**此快取只存在於 GitHub Actions 快取層、會自動過期，不構成持久存儲**（符合 D10「不落盤保存原始檔案」）；過期或未命中即重新下載並重新解析。
- **可觀測**：`ingestRuns` 記錄各階段耗時、頁數、tokens、成本估算。
- **殘留風險**：來源站點不可用或大改版時無法重跑 → 後台可見 `crawlIndex.status = failed` 並手動介入。

---

## 7. API 介面定義與前後端通訊

### 7.1 公開 API（`/api/v1`，匿名 session）

| 方法 | 路徑 | 說明 | 快取 |
|------|------|------|------|
| GET | `/programs` | 255 條方案元信息（驅動選擇器） | CDN 1h + SWR |
| GET | `/programs/:year/:code` | 完整要求樹 | CDN，ETag = revision |
| GET | `/courses` | 課程庫（`?subject=&q=&limit=`） | CDN 24h |
| GET | `/courses/:code` | 單課詳情 | CDN 24h |
| GET | `/courses/:code/references` | 反向索引 | CDN 1h |
| GET | `/common-core/:admissionYear` | 通識映射（二期） | CDN 24h |
| POST | `/session` | 建立匿名 session（`httpOnly` cookie） | — |
| GET | `/session/me` | profile + selection + 審計摘要 | `no-store` |
| PUT | `/session/profile` | 主修 / 輔修 / 分支 / 入學學年 | — |
| PATCH | `/session/selection` | 批量勾選變更（冪等） | — |
| GET | `/session/audit` | **後端權威核算** `ProgramAudit` | `no-store` |
| POST | `/transcripts` | 成績單 PDF 上傳解析（二期） | — |

### 7.2 管理員 API（`/api/v1/admin`，JWT + role guard）

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/admin/auth/login` / `/logout` / `/refresh` | 帳密登入（argon2）、登出、續期 |
| GET | `/admin/programs` | 資料瀏覽（year/code/issue/updatedBy 篩選，cursor 分頁） |
| GET | `/admin/programs/:year/:code` | 單份文檔（含 provenance 與 revision） |
| PUT | `/admin/programs/:year/:code` | 編輯（**樂觀併發**：必帶 revision，不符回 409） |
| POST | `/admin/programs/:year/:code/rollback` | 回退至指定 revision |
| GET / PATCH | `/admin/validation-issues[/:id]` | 資料檢查：篩選與標記處理 |
| GET | `/admin/audit-logs` | 審計查詢 |
| GET | `/admin/ingest-runs` | 管線執行紀錄與成本 |
| POST | `/admin/ingest-runs/:id/retry` | 重跑指定階段 |
| CRUD | `/admin/users` | 帳號管理（僅 `admin`） |

### 7.3 契約單源

```ts
// packages/contracts/src/program.ts —— 唯一定義處
export const ComboPart = z.object({ courses: z.array(ComboOption) });
export const ProgramDoc = z.object({
  year: z.string(), code: z.string(), revision: z.number(),
  groups: z.array(RequirementGroup), provenance: Provenance,
});
export type ProgramDoc = z.infer<typeof ProgramDoc>;   // web / api / worker 共用
```

- NestJS 用同一份 Zod → 生成 OpenAPI（`zod-to-openapi` + Swagger UI），**驗證與文件同源**；
- Nuxt 由 OpenAPI 生成型別化 client（`orval`），契約變更直接編譯失敗而非上線 500；
- 錯誤契約：`{ code, message, details?, requestId }`，`code` 為 contracts 枚舉（`PROGRAM_NOT_FOUND` / `REVISION_CONFLICT` / `SESSION_EXPIRED` …），前端單一轉換 composable 處理。

### 7.4 認證、CSRF、限流

- 匿名 session：`httpOnly` + `SameSite=Lax` + `Secure`，90 天 TTL、滑動續期，**不存個資**。
- 管理員：access JWT 15 分鐘（記憶體）+ refresh token 7 天（`httpOnly` cookie）；role = admin / editor。
- CSRF：寫操作校驗 `Origin` + `SameSite`，admin 寫操作加 double-submit token。
- 限流：公開讀依 IP + session；`/session/selection` 與 `/admin/*` 更嚴；`/transcripts` 限大小與頻率。

### 7.5 前端通訊層

- **同源**：`vercel.json` 將 `/api/*` rewrite 到 api service → 無 CORS、cookie 直通；SSR 期直呼服務位址。
- `useApi()`：baseURL、`credentials: 'include'`、錯誤正規化、`requestId`、僅 GET 重試。
- **快取與失效**：公開資料 CDN（`s-maxage` + `ETag=revision`）；管理員編輯後 revision 變化即邊緣取新，後台另提供「立即刷新」。
- 後台置於同源 `/admin` 路由；**前端 role guard 僅 UX，授權在 API**。

---

## 8. 部署與運維

### 8.1 Vercel services（非 Compose）

```jsonc
// infra/vercel.json
{
  "services": {
    "web": { "root": "apps/web", "entrypoint": "Dockerfile.vercel" },
    "api": { "root": "apps/api", "entrypoint": "Dockerfile.vercel" }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "api" } },
    { "source": "/(.*)",    "destination": { "service": "web" } }
  ]
}
```

- 兩鏡像皆須提供 HTTP（預設 80，可用 `PORT` 覆蓋），無狀態、按需冷啟、閒置 5 分鐘縮容。
- `apps/api` 鏡像精簡（僅 NestJS + Mongo driver）；管線依賴只進 worker。
- Mongo 連線池 `maxPoolSize: 5`、`serverSelectionTimeoutMS: 5000`（無狀態容器頻繁冷啟）。
- web 以 Nitro `node-server` preset 打包進鏡像以支援 SSR 首屏。

### 8.2 本地開發（唯一使用 Compose 處）

`infra/docker/compose.dev.yml`：`web` + `api` + `mongo`（本地副本）+ 一次性 `worker` task。僅本地與 CI e2e，非部署形態。

### 8.3 CI/CD

| 觸發 | 內容 |
|------|------|
| PR | lint + typecheck + 單元（domain/contracts/rules）+ 契約相容性檢查（schema 變更須標 semver）+ e2e（compose 起 api+mongo，Playwright）+ golden 回歸（255 份產物） |
| main | Vercel Git 整合自動部署 web + api；PR 有預覽環境 |
| 定時/手動 | `cron-crawl` → `pipeline-run`（worker，不隨 main 部署） |

### 8.4 環境變數

| 變數 | web | api | worker |
|------|-----|-----|--------|
| `MONGODB_URI` / `MONGODB_DB` | — | ✓ | ✓ |
| `SESSION_SECRET` / `JWT_SECRET` / `JWT_REFRESH_SECRET` | — | ✓ | — |
| `MINERU_API_TOKEN` | — | — | ✓ |
| `GRAD_LLM_API_KEY` / `_BASE_URL` / `_MODELS` | — | — | ✓ |
| `ADMIN_BOOTSTRAP_EMAIL/PASSWORD` | — | ✓（首次啟動建管理員） | — |
| `PUBLIC_API_BASE` | ✓ | — | — |

### 8.5 遷移與上線（一次性切換）

1. 建 Atlas 叢集（香港/新加坡）+ 最小權限 DB 使用者；因容器無靜態出網 IP，白名單 `0.0.0.0/0`，以強密碼 + TLS + 最小權限控管。
2. `worker migrate-legacy`：將 255 份 `requirements_*.json` + `courses.db`(1144) + `common-core-course-map.json` 一次匯入（`revision: 1`，provenance 標 `legacy-import`）。
3. **黃金對照**：舊站 vs 新 API 比對要求樹、組合折疊、分支過濾、學分進度一致。
4. 部署至 Vercel 預覽環境內部驗收（匿名 session、勾選、進度、後台登入、審計）。
5. 切 DNS 上線；**舊 Cloudflare Pages 站保留 2 週回退**。
6. 首次管線只跑 `verify` 不 `ingest`，人工審視差異後再開 ingest。
7. 舊 Python 管線與舊前端標記 `archived/`（保留 6 個月）。
8. 回退預案：DNS 切回舊站（舊站讀已提交靜態 JSON，資料層無損）。

### 8.6 成本估算（月度，起步期）

| 項目 | 估算 | 說明 |
|------|------|------|
| Vercel Pro | ≈ $20 | 容器函式 + services；800s 時長需 Pro（Hobby 僅 300s） |
| MongoDB Atlas M0 | $0 | 資料量約 10–20 MB，M0 足夠起步 |
| GitHub Actions | $0（public）/ 按分鐘（private 2000 min 免費額度） | 管線跑數小時需注意額度 |
| MinerU API + LLM | 按量 | 首次全量重跑：數十美元量級（約上萬頁）；之後增量極小 |
| 合計 | ≈ $20 + 按量 | 相對現行（Cloudflare Pages 免費）成本上升，是後端化的必然代價 |

### 8.7 風險與緩解

| 風險 | 緩解 |
|------|------|
| 規則移植回歸（組合 / 分支 / 通識） | 255 份產物作 golden sample，PR 必跑，差異率超閾值直接 fail |
| 無 PDF 存儲 → 重跑需重下載與重付解析費 | 增量（sha256）+ CI 快取 MinerU 產物 + 必要時才全量重跑 |
| Atlas 白名單須開放 `0.0.0.0/0` | 強密碼 + 最小權限 + TLS + 審計；後續評估 Private Endpoint |
| Vercel 容器冷啟動 | api 輕依賴 + CDN 快取 + Fluid compute |
| Vercel 函式時長 800s（Beta 1800s） | 重任務全在 GH Actions，API 僅毫秒級查詢 |
| monorepo 建置複雜度 | Turborepo 遠端快取 + 明確依賴方向（禁反向） |
| MinerU / LLM 限流 | 429 退避 + 模型池輪換 + 階段級斷點續跑 |

---

## 9. 測試策略

| 層級 | 內容 |
|------|------|
| 單元 | `packages/domain`（現有 112 條前端測試搬入）、`contracts`、`rules`（現有 28 條 pytest 語意以 TS 重寫）；`mineru-client` 與 extract 階段以**固定樣本 fixture + 單頁 PDF mock** 驗證，不依賴線上服務（因為 `pymupdf` 降級已下線，零成本鏈路驗證改由 mock 承擔） |
| 契約 | OpenAPI 與前端生成 client 一致性；schema 變更 semver 檢查 |
| 整合 | NestJS + `mongodb-memory-server`；repository 與 migration 測試 |
| e2e | compose 起 api + mongo，Playwright 跑關鍵路徑（選方案 → 勾選 → 進度 → 後台登入 → 編輯 → 審計） |
| Golden 回歸 | 255 份既有產物逐份比對（要求樹、組合、分支、學分核對結果） |
| 效能 | k6 基本壓測公開讀 API（CDN 命中前後） |

---

## 10. 分期落地

**一期（核心可用）**
monorepo 骨架 + `contracts`/`domain` 移植 + Mongo 模型與 `migrate-legacy` + 公開 API（方案 / 課程 / 反向索引）+ 匿名 session（勾選 / 進度 / audit）+ Nuxt 三視圖（瀏覽 / 勾選 / 進度 / 要求明細）+ 管理員登入與資料瀏覽 + Vercel 部署 + golden 對照。

**二期（能力補齊）**
成績單 PDF 上傳解析、通識判定、輔修 / EXTM 附加方案、`validationIssues` 完整校對流、`ingestRuns` 儀表板、爬蟲與管線接上 cron、`courseRefs` 重建與 CDN 失效優化。

---

## 11. 後續待決（ADR backlog）

1. Atlas 叢集規格與 Region 最終選型（M0 → M10 的觸發條件）。
2. LLM 模型池與成本上限策略（`GRAD_LLM_MODELS` 具體清單、token 預算）。
3. 爬蟲的來源站點條款與限速參數（robots / ToS 確認後定案）。
4. 是否引入 Sentry 等錯誤追蹤與告警渠道。
5. `packages/domain` 的版本策略（內部套件是否需要獨立 semver 與 changelog）。

---

## 附錄：外部事實依據（Vercel 能力）

- Vercel 支援 Docker 部署（OCI 映像以 Vercel Functions 運行）：<https://vercel.com/kb/guide/does-vercel-support-docker-deployments>（2025-11-03）
- 在 Vercel 上運行 Docker（`Dockerfile.vercel`、VCR、Services、縮容行為）：<https://vercel.com/kb/guide/docker>（2026-07-01）
- Vercel Functions 限制（2026-08-24）：記憶體 Hobby 2 GB / Pro 4 GB；執行時長預設 300s、Pro 最大 800s、擴展 1800s（Beta）；函式包體 250 MB（Python 500 MB、Large Functions 5 GB Beta）；請求/響應 4.5 MB；不支援 Secure Compute 與 Static IPs（容器映像）
- **Docker Compose 不被支援**；官方多服務方案為 `vercel.json` 的 `services` + `rewrites`

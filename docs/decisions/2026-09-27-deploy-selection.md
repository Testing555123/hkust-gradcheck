# 部署选型记录 · 一键入库 + 一键部署

日期：2026-09-27
决策人诉求：**0 元 · git push 自动部署 · 前端+后端+数据库三层统一到同一平台 · 不建备份（靠 git 重建）**

---

## 一、结论

| 层 | 选型 | 备注 |
|---|---|---|
| 学生端 SPA | Cloudflare Pages（`frontend/`） | 已在运行，git 集成现成，本次不动 |
| 后台 | Vercel Hobby（`apps/studio`） | Payload 3.90.2 + Next 16.3.3 |
| 数据库 | Neon Postgres 免费档 | 经 Vercel Storage 集成，同一项目内管理 |

**「三层统一」的诚实口径**：前后端同在 Vercel（一次 git push 一起发布），数据库通过 Vercel Storage 集成、在 Vercel 项目内创建与管理，但底层算力由 Neon 提供。严格意义的「同一内核」不成立——见第四节。

---

## 二、为什么放弃 MongoDB

用户裁决「可考虑放弃 mongodb」后，选型空间打开。Payload 官方适配器三选一（实时取自 payloadcms.com/docs/database/overview）：

- MongoDB with Mongoose
- **Postgres with Drizzle** ← 选中
- SQLite with Drizzle

选 Postgres 而非 SQLite 的原因：SQLite/D1 只能落在 Cloudflare，而 Cloudflare 已证伪（见下节）。

### 代价已实测

- 全仓 MongoDB 耦合只有 **3 处**（`payload.config.ts:1,21`、`package.json` 依赖、`.env.example`）。
  `ingest-baked.ts` / `gates.ts` / `seed.ts` 全走 Payload Local API，与适配器无关。
- `scripts/sync_to_atlas.py` **不用动**：它是服务 `../grad-check-web`（Nuxt + NestJS + Mongo）的另一条独立链路，与 Payload 无关。
- 新增工作量：**必须生成 migration**（Mongo 自动建集合，Postgres 必须建表），且部署时得跑 `payload migrate`。

---

## 三、Cloudflare 方案为何出局（一手证据）

最初推荐 Cloudflare 全家桶（Pages + Workers + D1），且有官方模板 `payloadcms/payload:templates/with-cloudflare-d1`。Spike 阶段被两条官方硬限制证伪：

**来源 1：developers.cloudflare.com/workers/platform/limits（最后更新 2026-09-05）**

| 限制 | Workers Free | 判定 |
|---|---|---|
| CPU 时间/请求 | **10 ms** | ❌ 官方文档原文：「Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms」——Payload admin 三项全中，必然超限返回 Error 1102，且该上限只有 Paid 档可调 |
| Subrequests/请求 | **50** | ⚠️ D1 查询计入此配额 |
| Worker size | 64 MiB（未压缩） | ✅ 不再是瓶颈 |

**来源 2：Cloudflare Containers 实时检索（2026-09-13）**
> "required for Containers (the Cloudflare free tier does not include Containers)"

免费档不含 Containers，0 元下 Cloudflare 无路可走。

---

## 四、其他候选为何未选（均已实时取证）

| 候选 | 关键事实 | 未选原因 |
|---|---|---|
| Render 免费档 | 512 MB RAM / 0.1 CPU / 15 分钟无流量休眠 / 持久磁盘仅付费档 | 跑不动 Payload+Next |
| Vercel + Atlas M0 | M0：0.5 GB / 500 连接 / 100 ops/s / **无备份** / 30 天零连接自动暂停 | 用户已放弃 MongoDB |
| Oracle Always Free + Coolify | 2026-08-18 起 ARM 额度由 4C24G 砍半至 **2C12G**，仍永久免费 | 需信用卡 + ARM + 全自运维，与「零运维」冲突 |
| Cloudflare Pages + Workers + D1 | 见上节 | CPU 10 ms 证伪 |

**Neon 免费档（实时核实）**：$0/月，100 CU-小时 + **0.5 GB** 存储/项目，支持 scale-to-zero。
本项目数据量（约 2 MB 方案树 + 1144 门课 + 1344 条反向索引）远低于 0.5 GB。

**D1 对比注记**：D1 免费档自带 7 天 Time Travel，比 Neon 免费档更符合「不备份」策略；但受 Workers CPU 限制牵连，一并不选。

---

## 五、已实测验证（本机真实输出，非推断）

数据库：本地 `postgres:16-alpine` 容器（`newone-pg`，127.0.0.1:55432）。

| 项 | 结果 |
|---|---|
| 迁移建表 | 15 张表：6 个数据集合 + `_programs_v` 版本表 + users + 系统表 ✅ |
| seed | 255 份方案 / 1753 组 / 76 含分支 / source_pages 1753/1753 / 绝对路径 0 份 ✅ |
| ingest | programs=255 · courses=1144 · course-refs=1344 · metas=3 · 含 derived=255 ✅ |
| 幂等 | 连跑两次，计数完全一致 ✅ |
| 数据闸门 | 拦住空 code、不误伤局部更新、正常改写放行 ✅ |
| 版本回滚 | `findVersions` / `restoreVersion` 在 Postgres 下行为正常 ✅ |
| `where: { derived: { exists: true } }` | Postgres 上语义正确（返回 255）✅ |
| 一键入库 | 从**空库**一条 `npm run db:init` 灌满，171.8 s ✅ |
| 构建 | `npm run build:studio` 通过，产出 `/admin` 与 `/api/site/*` ✅ |
| `npm run verify` | 八道门全绿（exit 0）✅ |

### 换库暴露的真实差异（已修）

Postgres 下文档 `id` 是 **number**（Mongo 下是 string），两处 `as string` 断言失效导致构建失败：
`gate-selftest.ts:24`、`seed.ts:78`。已改为不做硬编码类型断言，让类型随适配器推导。

### 踩到的坑（值得一记）

`ingest-baked.ts` **只补 `derived`，不创建 program**（找不到就 `continue`，且最终断言会拦下）。
正确顺序必须是 **migrate → seed → ingest**。顺序颠倒会「静默写 0 份、最后断言才报红」。
已固化进 `npm run db:init`。

---

## 六、尚未验证（需要真实账号，本机无法完成）

以下三项依赖 Vercel / Neon 账号，未实测：

1. **Vercel 对 monorepo 的构建行为**。已确认 `apps/studio` **不依赖** `packages/domain`（`src/` 内零引用），
   因此 Root Directory 取 `apps/studio` 在依赖上是自洽的。但 `next.config.ts` 里
   `turbopack.root` 指向仓库根、`output: 'standalone'` 是为 Docker 准备的，
   二者在 Vercel 上的实际表现**未验证**。
2. **`output: 'standalone'` 是否干扰 Vercel 的 Next.js 打包**。未验证。若构建产物异常，优先怀疑这一项。
3. **Neon serverless 下的入库耗时**。本机 171.8 s；Neon 每次往返是 HTTPS + 可能冷启动，
   `seed`/`ingest` 均为逐条 find-then-write（约 5500 次串行往返），预计慢一个量级，
   且会消耗免费档 100 CU-小时额度。**这是上线前必须实测的一项。**

---

## 七、需要人工完成的步骤

1. 在 Vercel 导入本仓库，Root Directory 设为 `apps/studio`。
2. 在 Vercel 项目里创建 Postgres（Vercel Storage / Neon 驱动），取得 `DATABASE_URL`。
3. 设置环境变量：`DATABASE_URL`、`PAYLOAD_SECRET`（务必换掉本地值）。
4. Build Command 覆盖为：`npm run migrate && npm run build`（Postgres 必须先建表，否则 `/admin` 打不开）。
5. 入库：`npm run db:init`（本地执行，指向 Neon 的 `DATABASE_URL`）。
6. 验证：`npm run site:parity`（258 项对拍）。

---

## 八、回落顺序

若 Vercel 实测不通（尤其第六节第 2、3 项）：

1. Vercel + Neon 换配置重试（如去掉 `standalone`）
2. Oracle Cloud Always Free（2C12G）+ Coolify，自建 Postgres 容器
3. 放弃 0 元，转 Railway / Render Starter（约 5-7 USD/月）

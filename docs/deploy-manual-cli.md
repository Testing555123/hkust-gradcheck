# Vercel + Neon 一键部署手册（CLI 代跑版）

本手册记录把 `apps/studio`（Payload 后台）与 Neon Postgres 落到 Vercel Hobby 的完整 CLI 流程，以及本次实战踩到的坑。目标：0 元、git push 自动部署、一条 `npm run db:init` 灌满数据。

## 一、前置条件（只需一次性）

1. **Vercel 登录**（开浏览器，凭证存本机）：
   ```powershell
   vercel login
   ```
2. **Neon 登录**（开浏览器）：
   ```powershell
   neonctl auth
   ```
3. **GitHub PAT**：在 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) 生成，勾 `repo`，过期建议 7 天。推送用后即弃，不要写进任何文件。

## 二、部署步骤

> 本仓已切到分支 `feat/deploy-vercel-neon`，部署相关改动均已提交（排除 `docs/domain-logic-and-tools.md`、`scripts/align_fundamentals.py`、`scripts/check_codes.py` 三个无关文件）。

1. **推送分支**（PAT 内联进 URL，`-q` 避免回显）：
   ```powershell
   $PAT="ghp_xxx"
   git push -q "https://${PAT}@github.com/Testing555123/newone.git" HEAD:refs/heads/feat/deploy-vercel-neon
   ```
2. **建 Neon 库并取连接串**（自带 `sslmode=require`）：
   ```powershell
   neonctl projects create --name newone-studio
   neonctl connection-string <project-id>
   ```
   把该串写入 Vercel 的 `DATABASE_URL`。
3. **建 Vercel 项目**（`vercel link` 非交互绑定；项目设置：Root Directory=`apps/studio`、Build Command=`npm run migrate && npm run build`）：
   ```powershell
   vercel link --yes --team studying5 --project newone-studio --cwd <repo-root>
   vercel env add DATABASE_URL   # 粘贴 Neon 连接串（覆盖 Production/Preview/Development）
   vercel env add PAYLOAD_SECRET # 用新值：node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
   ```
4. **触发部署**（推送即自动部署；或显式）：
   ```powershell
   vercel deploy --prod --yes --cwd <repo-root> --scope studying5
   ```
5. **一键入库**（见下方“坑③”后再跑，否则连不上）：
   ```powershell
   npm run db:init
   ```

## 三、实战踩坑与修复（重要）

### 坑①：`payload migrate` 在 Vercel 无 TTY 下交互挂死
构建卡在：
```
? It looks like you've run Payload in dev mode, meaning you've dynamically pushed changes to your database.
```
根因：迁移命令 `payload migrate` 仅在「数据库已存在 `payload-migrations` 表且其中有一行 `batch === -1`（dev 模式动态推送标记）」时才弹这个提示。Neon 库不是真·空库时就会触发。
修复：把 Neon 库清空成真正空库：
```sql
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
```
空库下 `migrate` 会直接 `Reading migration files → Migrating → Done`，**不再弹提示**。
另：构建用 `migrate` 即可，不要换成 `migrate:refresh`/`migrate:reset`——它们先 `down` 再 `up`，空库会因 `payload_migrations` 不存在而报错。

### 坑②：`output: 'standalone'` 导致 Vercel 构建失败
`next build` 之后报：
```
Error: ENOENT: no such file or directory, open '.next/next-server.js.nft.json'
```
根因：`next.config.ts` 里的 `output: 'standalone'` 是给 Docker 用的，在 Vercel + Turbopack 下会要求该 nft 追踪文件而缺失。**已在部署中移除该配置**（Vercel 不需要 standalone）。

### 坑③：本机跑 `db:init` / 直连生产域名失败
- 本机 Node `fetch('https://<xxx>.vercel.app')` 与 `curl` 都会 `Connect Timeout`（TCP 层连不上 `:443`），但 **PowerShell `Invoke-WebRequest` 偶发能连**。这是本机到 Vercel CDN 的区域/边缘连通性抖动，与部署无关。
- 本机 `npm run db:init` 若报 `ENOTFOUND base`，是另一个坑：

### 坑④：`vercel env pull` 把值用双引号包起来
`vercel env pull` 写出的 `.env` 形如 `DATABASE_URL="postgresql://..."`。若直接读取注入给 Node 子进程，pg 会把 host 解析成 `base` 而连不上。
修复：读取时用正则去掉首尾引号：
```js
env[key] = val.replace(/^["']|["']$/g, '')
```
（部署用 Vercel 注入的原始串则无此问题——这也是“构建能连、本地不能连”的原因。）

### 坑⑤：studio 的 Output Directory 被设成 `frontend/dist` → 全站 404（最严重的一个）
构建日志末尾报：
```
Error: The Next.js output directory "frontend/dist" was not found at "/vercel/path0/apps/studio/frontend/dist".
```
根因：studio 项目（Root=`apps/studio`）的 **Output Directory 被设成了 `frontend/dist`**——那是学生端 web 的目录；Next.js 的产物是 `.next`。
后果：`next build` 明明成功，但 Vercel 找不到产物 → 发布为空 → **所有路径（`/`、`/admin`、`/api/site/*`）一律 404**，学生端代理自然也拿不到数据。
修复：在 `apps/studio/vercel.json` 显式写 `"outputDirectory": ".next"`（该目录即 Root Directory，放仓库根不生效）。修复后构建日志出现 `Build Completed in /vercel/output`，`/admin` 与 `/api/site/index` 随即恢复 200。

### 坑⑥：带方括号的 catch-all 函数文件没被注册成路由
`api/site/[...path].js` 在构建日志里确实被编译（`Compiling "[...path].js" from ESM to CommonJS...`），但请求 `/api/site/index` 仍返回 Vercel 自带的
`{"message":"Route not found \"/api/site\""}`——**函数根本没被调用**。
对照实验：同项目的扁平函数 `/api/ping` 返回 200，说明 Vercel 能正常路由本项目 `api/` 下的函数，问题出在「嵌套目录 + 方括号 catch-all」这一形态。
修复：改为**扁平文件 `api/site.js` + rewrite 用 query 传参**，全程无方括号文件名：
```json
{ "source": "/api/site/(.*)", "destination": "/api/site?path=$1" }
```
函数内读 `req.query.path` 再转发到 studio。行为与原 catch-all 等价，四个端点全部实测 200。

## 四、复跑 / 回滚

- **重新入库**：`db:init` 三个脚本均幂等，连上正确 DATABASE_URL 直接重跑即可。
- **重新部署**：`vercel deploy --prod` 或 `git push` 触发。若曾 DROP SCHEMA，部署的 `migrate` 会先从迁移文件干净重建表。
- **连接不上 Neon**：确认 `DATABASE_URL` 来自 `neonctl connection-string`（带 `sslmode=require`），且未带首尾引号。

## 五、验证

- **根路径 `/`：由 `apps/studio/vercel.json` 的 `redirects` 跳到 `/admin`（307）**。studio 是「后台 + 数据 API」应用，`src/app/` 下只有 `(payload)/`（含 `admin/`）与 `api/site/`，**没有 `app/page.tsx`**，故裸根 404 属**设计使然，不是故障**；想让根路径进后台就用这条 redirect（`permanent:false`，将来做真首页不会被浏览器永久缓存）。配置必须放 `apps/studio/`（该目录即 studio 的 Root Directory），放仓库根不生效。
- 生产 `/admin` 应返回 200。
- 单端点抽样：`/api/site/program/2026-27/COMP` 应返回真实课程数据。
- 258 项对拍（需从能直连 Vercel CDN 的网络执行）：
  ```powershell
  node scripts/check_site_parity.mjs https://newone-studio.vercel.app
  ```
  期望 `258/258` 语义一致。
- 入库校验：Neon 内 `programs=255 / courses=1144 / course_refs=1344 / metas=3 / derived=255`。

## 六、当前线上状态（部署日快照）

- 生产域名：`https://newone-studio.vercel.app`（别名，亦为 `newone-studio-<hash>-studying5.vercel.app`）
- Neon：`ep-dry-rain-aze1ha8k...ap-southeast-1.aws.neon.tech`，已灌满上述数据。
- 学生端（`newone-web` 项目）已迁到 Vercel 静态托管，生产默认 `VITE_DATA_SOURCE=api` 直连 Payload 实时接口（经仓库根**同源 Serverless 函数** `api/site.js` 反代 `newone-studio` 的 `/api/site/*`，外部 rewrite 在 Vercel 实测不生效已弃用），后台改 `source` 立即反映；259 个 `public/data/*.json` 保留作 `VITE_DATA_SOURCE=static` 一键回退。

## 七、学生端前端（Vercel 静态托管 + Payload 实时 API）

把 `frontend/` 这份 Vite SPA 原样迁到 Vercel 作为独立极小项目 `newone-web`，运行期直连已上线的 Payload 接口（`newone-studio` 的 `/api/site/*`，读 Neon），**不重写任何学生端代码**。259 个 `public/data/*.json` 保留作 `VITE_DATA_SOURCE=static` 回退。

### 关键决策
- **Root Directory = 仓库根（不是 frontend）**。原因：SPA 的 `tsconfig.app.json` 与 `vite.config.ts` 把 `@/lib/*`、`@/types` 重定向到 `../packages/domain/src`（领域逻辑唯一来源）。若 Root=frontend，云端构建上下文不含仓库根兄弟目录 `packages/`，会 `TS2307: Cannot find module '@/lib/audit'`。把 Root 设为仓库根让整个仓库进构建上下文，`../packages/domain` 自然可用，零前端改动。
- **不设 `framework` 字段**（等价控制台 Other）。Vercel 的 framework 取值不含字面量 `"other"`，写了会 `Invalid request: projectSettings.framework should be equal to one of the allowed values...`。只用显式 `buildCommand` + `outputDirectory` 即可。
- **同源 serverless 函数反代而非 CORS / 外部 rewrite**：studio 的 `/api/site/*` 无 CORS 头，跨域直连必失败。最早用 vercel.json 的「外部 rewrite」做同域反代，但 Vercel 上外部 rewrite 经实测**不生效**（提交 `4817ced` 已确认），故改为仓库根的扁平同源 Serverless Function `api/site.js`（配合 rewrite 传参，见坑⑥）透传 `/api/site/*` 到 newone-studio；浏览器视作同源，无需任何后端改动，且能区分「后台不可达（502）」与「前端配置问题」。

### 文件
- `vercel.json`（仓库根，**唯一配置**；不要再加 `frontend/vercel.json`，否则 `outputDirectory` 与 Root 归属冲突，易发布空站）：
  ```json
  {
    "buildCommand": "npm run build",
    "outputDirectory": "frontend/dist",
    "rewrites": [
      { "source": "/api/site/(.*)", "destination": "/api/site?path=$1" }
    ],
    "headers": [ "/* /assets 长缓存 immutable、/data 短缓存 must-revalidate（见文件）*/" ]
  }
  ```
  - `npm run build` 是根脚本 `npm -w frontend run build`（即 `tsc -b && vite build`），产物落到 `frontend/dist`。
  - `rewrites` **只保留一条 `/api/site/(.*)` → `/api/site?path=$1`**：把转发路径以 query 传给下面的扁平函数。
    曾尝试用 catch-all 做 SPA 深链 fallback（`/((?!api/).*)`），但 Vercel 的 rewrite `source` 正则**不支持负向前瞻**，构建直接报 `invalid route source pattern`，故已放弃 SPA 深链 fallback——根路由 `/` 由 Vercel 静态托管自动返回 `index.html`。
    代价：客户端路由的「深链直访」（直接打开 `/programs/...`）会 404，需从 `/` 进入，或后续枚举路由 / 改用 framework 预设解决。
  - **不再使用外部 rewrite**：原 `/api/site/* → https://newone-studio.vercel.app/...` 的外部 rewrite 在 Vercel 上实测不生效，已删除。
- `api/site.js`（仓库根 `api/` 目录，扁平文件；Root=仓库根时由 Vercel 部署为 Serverless Function）：同源透传 `/api/site/*` 到 newone-studio，设 `Cache-Control: public, max-age=300, must-revalidate`，后台不可达时返回 502 JSON（便于区分问题归属）。
  - ⚠️ **不要**改回 `api/site/[...path].js` 这类方括号 catch-all：实测能被编译但**不会被注册成路由**（见坑⑥）。转发用的 path 由上面 `rewrites` 的 `?path=$1` 传入。

### 部署步骤
1. 建项目并连到仓库根（命令在仓库根目录执行）：
   ```powershell
   vercel project add newone-web --team studying5
   vercel link --yes --project newone-web --scope studying5
   ```
2. 注入数据源开关（production 走实时接口）：
   ```powershell
   echo "api" | vercel env add VITE_DATA_SOURCE production
   ```
3. 手动部署（在仓库根，项目已 link）：
   ```powershell
   vercel deploy --prod --yes
   ```
4. **git push 自动双部署**（可选，需 Dashboard 授权）：在 Vercel Dashboard 把 `newone-web` 连到 GitHub 仓库 `Testing555123/newone`（GitHub App 授权）。连上后同一 push 会同时构建 studio（Root=`apps/studio`）与 web（Root=仓库根）。CLI/API 连同一仓库时若报 `repo_not_found`，是 GitHub App 对该仓的访问授权问题，需到 Dashboard 处理（无法用 CLI/API 绕过）。

### 验证
- 根路由 `/` 应返回 200（SPA 首屏）。
- 经同源函数反代的 `/api/site/index` 应返回 200 且为实时数据（如 `{"code":"ACCT","year":"2023-24",...}`）；若返回 502 `studio proxy failed`，说明 newone-studio 未上线/不可达，与前端配置无关。
- pdfjs 资源随 `dist/assets` 静态分发，无需额外配置。
- 数据层未变（同一条 `/api/site/*`），原有 258 项对拍不受影响；如需回归，仍跑 `node scripts/check_site_parity.mjs https://newone-studio.vercel.app`。

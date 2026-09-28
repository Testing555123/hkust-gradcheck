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

## 四、复跑 / 回滚

- **重新入库**：`db:init` 三个脚本均幂等，连上正确 DATABASE_URL 直接重跑即可。
- **重新部署**：`vercel deploy --prod` 或 `git push` 触发。若曾 DROP SCHEMA，部署的 `migrate` 会先从迁移文件干净重建表。
- **连接不上 Neon**：确认 `DATABASE_URL` 来自 `neonctl connection-string`（带 `sslmode=require`），且未带首尾引号。

## 五、验证

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
- 学生端仍读静态 JSON（Cloudflare Pages），后台改 `source` 不会重算 `derived`（T9 未做，非本次范围）。

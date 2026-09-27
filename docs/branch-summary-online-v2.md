# 分支摘要 · `feat/online-v2`

基线 `67effce` → HEAD `5e40880`，共 **9 个提交，全部未 push**。
本轮范围 = 设计 v2 的 **T0–T3 + T4a/T5/T4b + T2b + ADR-12**。

## 一屏结论

| 问题 | 答案 |
|---|---|
| 学生端行为变了吗 | **没有**。前端 9,173 行 UI 一行未动，`npm test` 前后都是 112 passed |
| 那这个分支到底提升了什么 | 三件事：① 领域引擎**第一次可以在浏览器之外跑**；② 有了**四道会真咬人的数据闸门**；③ 多出一个能浏览/校对 255 份方案的**在线数据服务**（试用，未接线） |
| 现在能上线吗 | **不能**。双写回环（T9）未实现，DB 与 git 之间还没有闭环；学生端仍读静态 JSON |
| 最该先看的 | `npm run probe:audit`（30 秒看懂引擎在算什么）→ 后台 `http://localhost:3200/admin` → `npm run verify` |

## 提交逐条（含「你现在去哪看」）

| 提交 | 内容 | 你如何检视 | 实测证据 |
|---|---|---|---|
| `4348220` | T0–T3：领域层从 `frontend/src/lib` 移到 `packages/domain`；根 npm workspaces；黄金基准 + 平移忠诚度两道闸门；CI 改到仓库根跑 | `git show --stat 4348220`（22 个文件被 git 识别为 **rename，相似度 92–100%**） | 515 个数据文件 blob 一致；21 个文件逻辑行与 `67effce` 逐字一致 |
| `5065933` | T4a/T5/T4b：`apps/studio`（Payload 3.90.2 + Next 16 + Mongo 适配器，官方 blank 模板改写）；seed 灌 255 份；§5 隐私与结构闸门落到 DB 写入口 | `http://localhost:3200/admin` → Collections → Programs | seed 255 建档 0 失败；`source_pages` 1753/1753；分支方案 76/76 |
| `542f362` | 修两处**会让闸门空转**的缺陷（比对基准用 HEAD 导致平移提交后比 0 个文件仍报 ok；gen 会把脏数据升格为基线） | `python scripts/check_port_fidelity.py` 藏文件试试 | 「应比对 21、实到 N 即 FAIL」防线生效 |
| `227f999` | 独立评审推翻我 4 条 ✅ 后逐条复核并修 5 处（覆盖率造假、自指下限、自测污染真实数据等） | 见设计 v2 §14 表格 | 篡改被搬到前端的代码块仍报红并点名 |
| `04778e2` `dbf4354` | **T2b**：成绩单 PDF 的浏览器 IO 适配器（`File` API + Vite 专有 `?url`）移出领域层；`packages/domain` 摘掉 `pdfjs-dist`、`vite` 两个 devDep | `npm -w @newone/domain test` 独立跑通即证明 | **255/255 份方案在 Node 里跑完，0 崩溃** |
| `4ac9399` | **ADR-12**：255 份源一次性规范为统一格式（`indent=2` + `ensure_ascii=False` + 整数值不写 `22.0`）；新增 `normalize:check` 进 CI | `npm run normalize:check` | 归一后重烘焙，成品侧**仅 `meta.json` 1 行时间戳**变动 |
| `3ba8c36` `5e40880` | 重钉黄金基准；把「数据基线」与「平移基准」拆成两个字段（manifest schema 2） | 看 `baseline/manifest.json` 的 `baseline_commit` vs `port_baseline_commit` | verify 全链 exit 0 |

## 三条口径规则，现在能被你亲手验（这是 `probe:audit` 的全部意义）

以 `MATH 2024-25` 为例，实测输出：

```
[1] 互斥分支（§4.2）
    未选方向 → 总要求 30 学分（只剩公共核心）
    选「Applied Mathematics Track」 → 总要求 62 学分
    全组并列累加（错误口径）→ 295 学分，分母被放大 4.8 倍

[2a] 纯「N 选一」（§4.1 规则 1/3）—— Required Course(s): MATH2121 OR MATH2131
     只勾 1 门 → takenCredits 4；两个备选全勾 → takenCredits 4
     ✅ 备选项没有被重复累加

[2b] 嵌套 AND-in-OR（§4.1 规则 2「部分完成计 0」）—— Major Pre-requisite course(s)
     只勾该选项第 1 个 part → takenCredits 0
     把该选项所有 part 勾齐 → takenCredits 7
     ✅ 捆绑只完成一半时不计分

[3] 逐组封顶（§4.4）
     该组 takenCredits 7、要求 4 → 计入方案级时被封顶为 4
     ✅ 超修部分没有拿去抵其他组的缺口
```

换方案看不同形态：`PROBE_CODE=COMP`（无分支）、`PROBE_CODE=ELEC`（Option）、`PROBE_CODE=SREQ-SSCI`（学院要求）。

## 这个分支**没有**提升的部分（避免你误判）

1. **学生端零改动** —— 仍读 `frontend/public/data/*.json`，Payload 与学生端之间**没有任何连线**。
2. **双写回环未实现** —— 后台改数据不会写回 git，`restoreVersion` 只回滚 DB。设计 §5 的核心机制仍是纸面的。
3. **首屏列表形态从未被真实测量** —— `select[year]=1` 实测只返回 `{id}`，我先前那组「255 条 9 KB / 0.060s」是空壳，已作废。
4. **6 个 collection 里只有 1 个有数据** —— `courses` / `course-refs` / `common-core-maps` / `metas` / `validation-issues` 全是 0 条。
5. **F3 的结论是「一半」** —— 后台表头是真表单，但改要求树 = 在 **1,718 行的 Monaco 编辑器**里改 JSON，与今天用 VS Code 无实质差别。**选 Payload 的代价已付（790 MB / 双 React / 上游发布节奏），收益尚未证明。**

## 服务与清理

| 服务 | 地址 | 停法 |
|---|---|---|
| 学生端 SPA | `http://localhost:5173/` | `netstat -ano \| findstr :5173` → `taskkill /F /PID <pid>` |
| Payload 校对后台 | `http://localhost:3200/admin`（`dev@newone.local` / `newone-trial-2026`，一次性本地值） | 同上，端口 3200 |
| 试用 MongoDB | 容器 `newone-payload-trial`，`127.0.0.1:27019`，库 `newone_studio` | `docker rm -fv newone-payload-trial` |

⚠️ **`stash@{0}` 里有他人 58 个未提交改动**（GitHub Desktop 切分支时 autostash）。其中 35 个源文件会与本分支 `4ac9399`（格式规范化）**冲突**。因为规范形式实测是不动点，`git stash pop` 之后再跑一次 `npm run normalize:apply` 即可，不必手工重排。

## 下一步（依赖顺序，不可乱）

1. **T7** `derived` 重算（combos/pool/order_index）—— 顺带补齐那 5 个空 collection
2. **ADR-10** 归一化规则两份实现收敛（`source-pdf.ts` vs 烘焙器）—— T9 的前置
3. **T9** 双写回环 —— 此时才谈得上「DB 为编辑权威」
4. **ADR-8/9/11/13** 四个收口决策
5. 决定 F3：若后台编辑体验不值 790 MB，按设计 §2.4 的回退条款转 PocketBase

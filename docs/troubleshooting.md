# 踩坑复盘：离线数据管线从 0 到可用

> 本文档记录「毕业要求查询与学分核查系统」数据管线开发过程中真实遇到的问题与解法，
> 覆盖 LLM 服务选型、PDF 解析 API、限流对抗、模型质量治理四个方面。供后来者参考。

## 背景

目标：把 255 份官方培养方案 PDF 转成结构化的「毕业要求规则库」入库。
架构：`PDF → MinerU 解析 → LLM 结构化抽取（带页码引用）→ requirements.json → 学分交叉核对 → SQLite`。
LLM 只跑离线管线，前端查库实时展示。

---

## 1. LLM 服务选型踩坑

### 1.1 OpenAI 官方端点：403 地区限制

```
openai.PermissionDeniedError: Error code: 403
{'code': 'unsupported_country_region_territory'}
```

**教训**：key 能连通 ≠ 能用，OpenAI 对部分地区直接 403。
**解法**：改用 OpenAI 兼容协议的第三方网关/国产模型（智谱、DeepSeek、本地聚合网关均可，代码零改动——只要换 `base_url`）。

### 1.2 智谱 glm-4.5-flash：「不报错但永远不返回」

现象：请求长时间挂起（5 分钟+），无任何输出。
**根因**：GLM-4.5 系列是**混合推理模型**，默认开启深度思考（thinking）。复杂抽取 prompt 的思考阶段极长。
**解法**：请求体带禁思考扩展字段（对不兼容的服务会被忽略，无害）：

```json
{
  "thinking": {"type": "disabled"},
  "chat_template_kwargs": {"enable_thinking": false},
  "reasoning_effort": "none"
}
```

### 1.3 智谱免费档：429 限流连锁

现象：单次调用成功后，后续全部 `429`（免费 flash 档速率限制极低），且错误信息被编码搞乱。
**解法**：429 指数退避重试 + 多模型轮换（见 §4）。

### 1.4 HuggingFace 免费上游：60 秒硬超时

现象：小请求 1.4s 正常，真实抽取请求必现 `502 upstream_failed: The operation was aborted (60s)`。
**根因**：网关路由到的 HF 免费端点有 60 秒硬超时；4 页文本 + 大 JSON 输出的请求必然超时。
**教训**：**探活成功 ≠ 生产可用**。测试 LLM 服务时必须用与真实负载同量级的 prompt（大文本 + 完整输出结构），小请求通过毫无意义。

---

## 2. MinerU PDF 解析 API 踩坑

### 2.1 端点 404：文档与真实 API 脱节

按网传资料调用 `POST /api/v4/file_parse`（multipart 上传）→ `404 Not Found`。
**解法**：安装官方 `mineru-open-sdk`，**直接读它的源码**反查真实端点：

```
1. POST {base}/file-urls/batch          → 申请预签名上传链接（返回 batch_id + file_urls）
2. PUT  文件到预签名 URL                 → 无需认证头
3. GET  {base}/extract-results/batch/{batch_id}   → 轮询 state（waiting-file/pending/running/done/failed）
4. 下载 full_zip_url → zip 内含 *.md + *_content_list.json（page_idx 天然带页码）
```

**教训**：API 文档滞后/不完整时，**官方 SDK 源码是最可靠的规格书**。

### 2.2 pymupdf 文字版 PDF 的陷阱

官方 PDF 是文字版，pymupdf 能抽出文本——但**课程表格被拆成乱序文本流**（`COMP\n1023\nIntroduction...`），且 `find_tables()` 检测不到无边框表格。OR/AND 组合规则完全无法还原。
**教训**：文字版 ≠ 结构完整。课程/学分类表格必须用带版面分析的解析器（MinerU 的表格解析正是为此）。
**缓解**：管线把 pymupdf 做成可插拔降级后端 + 解析结果落盘缓存（`cache/`），同一文件只解析一次。

---

## 3. 本地聚合网关（FreeLLM API）踩坑

### 3.1 「模型列表有 248 个」≠「能用 248 个」

`/v1/models` 列出 248 个模型变体，并发实测后：
- 大量路由 `404 not in catalog` / `429 no usable key configured`（**根本没配上游 key**）
- 部分模型对真实大 prompt 结构性 `400`（小请求探活全过）

**教训**：探活必须用真实负载量级；模型池只收「大 prompt 实测通过」的成员。

### 3.2 模型质量参差：坏 JSON 比失败更贵

部分模型输出合法 JSON 但**缺字段**（如课程缺 `credits`）——Pydantic Schema 校验失败。
处理链：Schema 校验失败 → 带「上次输出 + 错误详情」的 repair prompt 自动重试 → 仍失败换模型。
**教训**：给 LLM 输出上 Pydantic 校验 + 自动修复重试，是结构化抽取的标配。

### 3.3 限流对抗：多模型轮换 + 耐心退避

免费网关限流**按模型独立计数**（另叠加每 IP 全局限流）。单模型必被 429 卡死。
最终方案：
- **模型池轮换**：429 时自动切换池中下一个实测可用模型（轮换靠 `itertools.count` 全局游标）
- **30 轮 × 10s 退避**：足够熬过数分钟的冷却窗口
- **动态淘汰**：结构性失败（400/404）的模型直接移出池子
- 批量任务失败自动跳过 + 断点续跑（按产物文件判断），失败份下次 `--all` 自动补齐

---

## 4. 数据层踩坑

### 4.1 只读 SQLite：attempt to write a readonly database

爬虫产出的 `courses.db` 带只读属性，FastAPI 启动建表直接崩。
**解法**：不碰原库——启动时复制为可写工作副本 `grad.db`，一切读写走副本；原库更新后删副本重建。

### 4.2 SQLModel create_all 不会加列

已有表新增字段（`area` 列）后 `create_all` 静默跳过（它只建缺失的表）。
**解法**：`init_db()` 里加轻量迁移：`PRAGMA table_info(...)` 检查列 → `ALTER TABLE ADD COLUMN`。

### 4.3 课程库覆盖缺口 ≠ LLM 幻觉

crosscheck 报告 67 门课 `missing_in_courses_db`——排查确认课程库只收录了部分课程（COMP 仅 26 门），抽取本身 **0 个学分错误**。
**教训**：先验证数据源的覆盖范围再怀疑模型。反过来，crosscheck 的 missing 清单就是课程库的补全清单。

---

## 5. 前端踩坑

### 5.1 `/api/api/programs`：路径重复 404

后端路由带 `/api` 前缀 → OpenAPI paths 已含 `/api`，openapi-fetch 的 `baseUrl` 又拼了一次 `/api`。
**解法**：`baseUrl` 用根路径，生成客户端的 paths 自带前缀。

### 5.2 TanStack Query 缓存旧数据：「课程缺失」的错觉

后端数据更新后前端仍显示旧培养方案（`staleTime: 5min` + 相同 queryKey）。
**解法**：只读静态数据 `staleTime: 0`，始终拉取最新；用户侧硬刷新兜底。

### 5.3 PowerShell 引号地狱

`python -c "..."` 内嵌 JSON 双引号在 PowerShell 中几乎无法转义。
**解法**：诊断脚本写成 `.py` 文件执行；SQL 内嵌引号用 `chr(39)` 拼接；`python` 命令是 Windows Store 占位符，一律用 `py` 或 venv 绝对路径。

---

## 经验清单（TL;DR）

1. **LLM 输出必须过 Pydantic 校验**，坏 JSON 自动修复重试
2. **探活用真实负载**，小请求通过毫无意义（60s 超时 / 400 都藏在真实负载里）
3. **限流按模型独立计数** → 多模型轮换是免费资源下最强的吞吐杠杆
4. **API 文档不可靠时读官方 SDK 源码**
5. **解析结果落盘缓存**（断点续跑 + 省钱省时）
6. **管线与在线服务彻底解耦**：LLM 永不直接写库，产物 JSON 可 diff、可人工修订
7. **原库只读，副本可写**，数据源更新 = 删副本重来

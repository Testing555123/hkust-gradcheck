# 数据更新指南

当教务处发布新学年培养方案（或现有 PDF 修订）时，按以下流程更新网站数据。

## 1. 获取新 PDF

用你已有的爬虫下载新学年 PDF 到：

```
unpress_pdf/major/<学年>/<CODE>_<Title>.pdf
```

并同步更新索引 `unpress_pdf/major/index.json`（字段：`year / code / title / filename / pdf_url / status`，`status` 须为 `downloaded` 才会被管线调度）。

## 2. 单专业试跑（强烈建议）

```powershell
cd pipeline
$env:PYTHONIOENCODING='utf-8'
..\ .venv\Scripts\python.exe -m run_pipeline --year <新学年> --code <专业代码>
```

检查两件事：
- `pipeline/reports/crosscheck_<学年>_<代码>.md` — 学分差异报告。`credits_mismatch` 表示 LLM 抽取与课程库不一致，`missing_in_courses_db` 表示课程库缺这门课。
- `pipeline/output/requirements_<学年>_<代码>.json` — 抽取结果。

## 3. 人工校对 requirements.json

重点核对：
- 每组 `required_credits` 是否与 PDF 原文一致（页码引用 `source_pages` 可直接翻 PDF 对照）
- 带 `note` 的组合规则是否完整（组级 note 会在前端显示为「官方说明」引用块）
- **选修课的 `areas` 字段**：每门选修课的 Area 归属（同课可属多 Area）；旧产物无此字段时前端优雅降级（不显示 Area 分块），可用 `--force` 重跑补齐
- `uncertain` 数组中 LLM 自述不确定的条目

直接编辑 JSON 保存即可——**seed 只认 output/ 下的 JSON，人工修订是流程的一部分**。

### 关于 Area 字段与旧产物兼容

| 产物版本 | note | areas | 前端表现 |
|---------|------|-------|---------|
| 旧 Schema 产物 | 有 | 无 | 显示官方说明，选修课平铺不分组 |
| 新 Schema 产物（2026-09 后） | 有 | 有 | 显示官方说明 + 选修课按 Area 分块 |

如需为旧产物补 Area 数据：`run_pipeline_env.bat --all --force`（MinerU 解析结果有本地缓存，只消耗 LLM 时间）。

### 多模型轮换（FreeLLM API 网关）

免费网关按模型独立限流，`run_pipeline_env.bat` 内置 8 个实测可用模型的轮换池
（`GRAD_LLM_MODELS`），429 时自动切换下一个模型。若仍频繁 429，建议在网关管理界面
为更多路由补配上游 API key（部分路由报 "no usable key configured"）。

## 4. 批量处理与导入

确认样本无误后：

```powershell
# 批量（断点续跑，已完成的自动跳过）
..\ .venv\Scripts\python.exe -m run_pipeline --all

# 全部校对完成后导入
..\ .venv\Scripts\python.exe ..\backend\scripts\seed.py
```

`seed.py` 按 (year, code) 重建式写入：重复导入同一方案会先删旧记录，可放心多次执行。

## 5. 验证

```powershell
# 接口抽查
curl http://127.0.0.1:8000/api/programs
curl http://127.0.0.1:8000/api/programs/<学年>/<代码>
```

前端刷新后应能在选择器中看到新学年/专业。

## 故障排查

| 现象 | 处理 |
|------|------|
| `缺少 MINERU_API_TOKEN` | 到 https://mineru.net 获取并设置环境变量；或先用 `--parser pymupdf --skip-llm` 验证链路 |
| 大量 `missing_in_courses_db` | 新学年课程代码未收录进 courses.db，先更新课程库再重跑 crosscheck（`--crosscheck-only`） |
| `courses.db` 更新后网站数据没变 | 删除 `backend/data/grad.db` 重启后端（启动时自动从原库重新复制） |
| 批量中断 | 直接重跑同一命令，断点续跑会跳过已完成项 |

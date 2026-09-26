/**
 * source_pdf 归一化：把本机绝对路径转成仓库相对路径。
 *
 * ⚠️ 技术债（已记入设计 §13）：同一条规则在 Python 烘焙器
 * `scripts/export_static_data.py:_normalize_source_pdf` 已有第二份实现。
 * 领域文档 §6.3 要防的正是「定义分散两处漂移」。本轮按用户裁决在 ingest 侧归一化，
 * 收敛方案是把它提到 packages/domain 由两侧共用 —— 见 ADR-10。
 *
 * 规则与烘焙器逐条对齐：反斜杠转正斜杠 → 从 unpress_pdf/ 处截断 →
 * 不含该标记（旧机器产物等）则只留文件名，避免把目录结构带上网络。
 */
const MARKER = 'unpress_pdf/'

export function normalizeSourcePdf(raw: unknown): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  const text = String(raw).replace(/\\/g, '/')
  const idx = text.toLowerCase().indexOf(MARKER)
  if (idx === -1) return text.split('/').filter(Boolean).pop()
  return text.slice(idx)
}

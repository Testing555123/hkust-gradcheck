import type { CollectionBeforeValidateHook } from 'payload'

/**
 * §5 不变量闸门中「DB 写入路径上」的那几条。
 * 数量/结构类断言永远执行、失败即拒绝写入 —— 领域文档 §5：「任何一条不成立就是数据坏了，
 * 必须在写入/发布前失败且不产出任何结果」。
 */

/** §5 隐私闸门：source_pdf 必须是仓库相对路径，不得含本机绝对路径。
 *  现状：这条只在烘焙期由 export_static_data.py 的 _normalize_source_pdf 截断保护，
 *  DB 写入路径上原本没有防线 —— 后台粘贴一个 C:\Users\... 就能把它带上公网。 */
const ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]|^\\\\|^\/(Users|home|var|opt|mnt|media)\//

/** 单一判断，闸门与断言共用，避免同一规则出现两份实现。 */
export function isAbsoluteLocalPath(raw: unknown): boolean {
  return typeof raw === 'string' && ABSOLUTE_PATH.test(raw.replace(/\\/g, '/'))
}

export function findAbsoluteSourcePdf(value: unknown): string | null {
  const raw = (value as { source_pdf?: unknown } | undefined)?.source_pdf
  return isAbsoluteLocalPath(raw) ? String(raw) : null
}

/** §5 结构闸门：每组必须有 name 与 required_credits。
 *  注意口径：order_index / source_ref / combos 是烘焙派生物，源里没有，此处不得要求。 */
export function findSourceShapeErrors(source: unknown): string[] {
  const errors: string[] = []
  const groups = (source as { groups?: unknown } | undefined)?.groups
  if (!Array.isArray(groups)) {
    return ['source.groups 不是数组']
  }
  groups.forEach((group, i) => {
    const g = group as Record<string, unknown>
    if (typeof g?.name !== 'string' || !g.name.trim()) errors.push(`第 ${i} 组缺 name`)
    const credits = g?.required_credits
    if (credits !== undefined && credits !== null && typeof credits !== 'number' && typeof credits !== 'string')
      errors.push(`第 ${i} 组 required_credits 类型异常`)
    if (Array.isArray(g?.courses)) {
      g.courses.forEach((c, j) => {
        const cc = c as Record<string, unknown>
        if (typeof cc?.code !== 'string' || !cc.code.trim()) errors.push(`第 ${i} 组第 ${j} 门课缺 code`)
      })
    }
  })
  return errors
}

export const programBeforeValidate: CollectionBeforeValidateHook = ({ data, operation, originalDoc }) => {
  const errors: string[] = []
  // 必填按「有效值」判断：部分更新时 data 只带被改的字段，
  // 直接看 data.code 会把一切不含 code 的合法局部编辑误杀（自测实测到）。
  const prev = (originalDoc ?? {}) as Record<string, unknown>
  const cur = (data ?? {}) as Record<string, unknown>
  const year = cur.year !== undefined ? cur.year : prev.year
  const code = cur.code !== undefined ? cur.code : prev.code
  if (typeof year !== 'string' || !year.trim()) errors.push('year 有效值缺失或为空')
  if (typeof code !== 'string' || !code.trim()) errors.push('code 有效值缺失或为空')

  const absolute = findAbsoluteSourcePdf(cur.source ?? prev.source)
  if (absolute) errors.push(`source_pdf 是本机绝对路径，禁止入库：${absolute}`)

  const source = cur.source ?? prev.source
  if (cur.source !== undefined) errors.push(...findSourceShapeErrors(cur.source).map((e) => `source 结构：${e}`))
  else if (operation === 'create') errors.push(...findSourceShapeErrors(source).map((e) => `source 结构：${e}`))

  if (errors.length) {
    throw new Error(`数据闸门未通过：\n  - ${errors.slice(0, 12).join('\n  - ')}`)
  }
  return data
}

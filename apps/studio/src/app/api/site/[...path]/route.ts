/**
 * 学生端读接口（T11 的服务端一半）：一个 catch-all 提供四种形态，
 * 返回的**结构与静态文件一致**，因此前端只需换 URL、不必换形状。
 *
 * 为什么不直接用 Payload 自带的 /api/programs：
 *   1. 实测 `select[year]=1&select[code]=1` 只返回 `{id}` —— 投影语法不生效，
 *      设计 §4.2 原先写的读法是错的（已在设计里改标）。
 *   2. 默认返回带 id/createdAt/updatedAt/versions 等运维字段，学生端不需要。
 *   3. index.json / course_index.json 是跨语料聚合，本就该整份取。
 *
 * 等价性由 scripts/check_site_parity 把关：解析后深度相等，且逐字节差异会被列出。
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import type { Program } from '../../../../payload-types'

type Ctx = { params: Promise<{ path: string[] }> }

const json = (data: unknown) => NextResponse.json(data)

async function metaCounts(payload: Awaited<ReturnType<typeof getPayload>>, key: string) {
  const r = await payload.find({ collection: 'metas', where: { key: { equals: key } }, limit: 1, depth: 0 })
  return (r.docs[0] as unknown as { counts?: unknown })?.counts
}

export async function GET(_req: Request, ctx: Ctx) {
  const { path = [] } = await ctx.params
  const payload = await getPayload({ config })
  const [head, ...rest] = path

  try {
    if (head === 'index') {
      const data = await metaCounts(payload, 'program-index')
      return data ? json(data) : NextResponse.json({ error: 'program-index 未导入' }, { status: 503 })
    }

    if (head === 'course-index') {
      const data = await metaCounts(payload, 'course-index')
      return data ? json(data) : NextResponse.json({ error: 'course-index 未导入' }, { status: 503 })
    }

    if (head === 'courses') {
      const r = await payload.find({ collection: 'courses', limit: 0, depth: 0, sort: 'code' })
      // 还原成静态文件的键与顺序：credits 用原文串，不是解析后的数字
      return json(r.docs.map((d) => {
        const c = d as unknown as Record<string, unknown>
        return {
          code: c.code,
          title: c.title,
          credits: c.creditsRaw,
          prerequisites: c.prerequisites,
          offered_semesters: c.offeredSemesters,
        }
      }))
    }

    if (head === 'program') {
      const [year, code] = rest
      if (!year || !code) return NextResponse.json({ error: '需要 /api/site/program/<year>/<code>' }, { status: 400 })
      const r = await payload.find({
        collection: 'programs',
        where: { and: [{ year: { equals: year } }, { code: { equals: code } }] },
        limit: 1, depth: 0,
      })
      const derived = (r.docs[0] as unknown as Program | undefined)?.derived
      if (!derived) return NextResponse.json({ error: `无 ${year} ${code} 的派生数据` }, { status: 404 })
      return json(derived)
    }

    return NextResponse.json({ error: `未知端点 /api/site/${path.join('/')}` }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

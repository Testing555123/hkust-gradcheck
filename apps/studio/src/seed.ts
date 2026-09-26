/**
 * T5 种子导入：把 pipeline/output/** 的 255 份权威源灌进 programs。
 *
 * 刻意从「源」而非烘焙成品导入 —— 实测源里有 required_credits_raw / source_pages / branch*，
 * 成品里没有（成品反而多出 combos/pool/order_index）。若从成品灌，§6.7 第 4 步
 * 「用 source_pages 翻原文核对 required_credits」就无从执行。
 *
 * 跑完自带断言：数量与覆盖率不达标即 exit 1（闸门语义，不是日志）。
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPayload, type Payload } from 'payload'

import config from './payload.config'
import { isAbsoluteLocalPath } from './gates'
import { normalizeSourcePdf } from './source-pdf'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SOURCE_ROOT = path.join(REPO, 'pipeline', 'output')

type SourceDoc = {
  year?: string
  code?: string
  title?: string
  total_required_credits?: number | string
  source_pdf?: string
  uncertain?: unknown[]
  groups?: { name?: string; required_credits?: number | string; source_pages?: number[]; branch_kind?: string; courses?: { code?: string }[] }[]
}

function* discover(): Generator<{ category: string; file: string }> {
  for (const category of readdirSync(SOURCE_ROOT)) {
    const dir = path.join(SOURCE_ROOT, category)
    if (!statSync(dir).isDirectory()) continue
    for (const code of readdirSync(dir)) {
      const codeDir = path.join(dir, code)
      if (!statSync(codeDir).isDirectory()) continue
      for (const f of readdirSync(codeDir)) {
        if (f.startsWith('requirements_') && f.endsWith('.json')) yield { category, file: path.join(codeDir, f) }
      }
    }
  }
}

const parse = (file: string) => {
  const raw = readFileSync(file, 'utf8')
  return { doc: JSON.parse(raw) as SourceDoc, dataVersion: createHash('sha256').update(raw).digest('hex').slice(0, 12) }
}

async function upsert(payload: Payload, category: string, file: string) {
  const { doc, dataVersion } = parse(file)
  if (!doc.year || !doc.code) throw new Error(`源文件缺 year/code：${file}`)
  const existing = await payload.find({
    collection: 'programs',
    where: { and: [{ year: { equals: doc.year } }, { code: { equals: doc.code } }] },
    limit: 1,
  })
  const data = {
    year: doc.year,
    code: doc.code,
    category,
    title: doc.title,
    totalRequiredCredits: doc.total_required_credits,
    // 按用户裁决在 ingest 侧归一化；beforeValidate 仍拒绝对对路径，
    // 所以归一化一旦失效，后果是「写入被拒」而不是「泄漏上线」。
    source: { ...doc, source_pdf: normalizeSourcePdf(doc.source_pdf) },
    dataVersion,
    provenance: { origin: 'pipeline/output', file: path.relative(REPO, file).replace(/\\/g, '/') },
  }
  if (existing.docs.length) {
    await payload.update({ collection: 'programs', id: existing.docs[0].id as string, data })
    return 'updated' as const
  }
  await payload.create({ collection: 'programs', data })
  return 'created' as const
}

async function main() {
  const found = [...discover()]
  console.log(`[seed] 发现源文档 ${found.length} 份于 ${path.relative(process.cwd(), SOURCE_ROOT) || '.'}`)

  const payload = await getPayload({ config })
  let created = 0
  let updated = 0
  const failures: string[] = []
  for (const item of found) {
    try {
      ;(await upsert(payload, item.category, item.file)) === 'created' ? created++ : updated++
    } catch (err) {
      failures.push(`${path.basename(item.file)}: ${(err as Error).message.split('\n').slice(0, 2).join(' / ')}`)
    }
  }
  console.log(`[seed] created=${created} updated=${updated} failed=${failures.length}`)
  for (const f of failures.slice(0, 5)) console.log('   ✗ ' + f)

  // ---- 断言（不达标即非 0 退出）----
  const all = await payload.find({ collection: 'programs', limit: 0, depth: 0 })
  const docs = all.docs as unknown as { source: SourceDoc }[]
  let groups = 0
  let withSourcePages = 0
  let withRawCredits = 0
  let branchDocs = 0
  let courseRefs = 0
  let absLeaks = 0
  for (const d of docs) {
    const gs = d.source?.groups ?? []
    let branched = false
    if (isAbsoluteLocalPath(d.source?.source_pdf)) absLeaks++
    for (const g of gs) {
      groups++
      courseRefs += g.courses?.length ?? 0
      if (g.source_pages) withSourcePages++
      if ((g as Record<string, unknown>).required_credits_raw !== undefined) withRawCredits++
      if (g.branch_kind) branched = true
    }
    if (branched) branchDocs++
  }

  const expect = { 方案数: [docs.length, 255], 要求组数: [groups, 1753], 含分支方案数: [branchDocs, 76] }
  console.log('\n[断言]')
  let bad = 0
  for (const [name, [actual, want]] of Object.entries(expect)) {
    const ok = actual === want
    if (!ok) bad++
    console.log(`  ${ok ? '✅' : '❌'} ${name}: ${actual} (期望 ${want})`)
  }
  console.log(`  ${withSourcePages === groups ? '✅' : '❌'} source_pages 覆盖率: ${withSourcePages}/${groups}`)
  console.log(`  ${withRawCredits === groups ? '✅' : '❌'} required_credits_raw 覆盖率: ${withRawCredits}/${groups}`)
  console.log(`  ℹ️ 课程引用数: ${courseRefs}`)
  console.log(`  ${absLeaks === 0 ? '✅' : '❌'} DB 内含绝对路径的 source_pdf: ${absLeaks} 份（必须为 0）`)
  if (withSourcePages !== groups) bad++
  if (withRawCredits !== groups) bad++
  if (absLeaks !== 0) bad++

  const secretOk = existsSync(path.join(REPO, 'apps/studio/.env'))
  console.log(`\n[env] apps/studio/.env ${secretOk ? '存在（已被 .gitignore 覆盖）' : '缺失'}`)
  if (failures.length || bad) {
    console.log(`\n[FAIL] 闸门未通过：写入失败 ${failures.length} 项、断言未达 ${bad} 项`)
    process.exit(1)
  }
  console.log('[ok] 种子导入与断言全部通过')
  process.exit(0)
}

await main()

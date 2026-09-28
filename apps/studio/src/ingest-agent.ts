/**
 * T-agent：把 agent bot 的产物写进 Payload。
 *
 * 为什么写在 studio 里而不是 worker 里：Payload Local API 需要 db-postgres 适配器
 * 与 lexcal editor 等一堆依赖，worker 再装一套就得跟 studio 死钉版本号；
 * 放在 studio 内直接 `getPayload({ config })`，依赖只有一份，也和既有
 * ingest-baked.ts 保持同一套路。worker 通过 `npm -w @newone/studio run ingest:agent` 调它。
 *
 * 幂等策略：
 * - source-chunks 按 chunkId upsert（chunkId 是稳定哈希，重复跑不会产生新行）；
 * - programs 的 lastPipelineHash 与 PDF 哈希相同就跳过写库，
 *   否则每天定时跑一遍会把 versions 刷成几百个无意义版本；
 * - validation-issues 先清掉该 (year, code) 的旧 agent 条目再重建，避免越堆越多。
 *
 * 跑法：npm -w @newone/studio run ingest:agent
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import { getPayload } from 'payload'

import config from './payload.config'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const DEFAULT_OUT = path.join(REPO, 'pipeline', 'output', 'agent')

type Rec = Record<string, unknown>

interface ChunkRow {
  chunk_id: string
  page: number
  ordinal: number
  char_start?: number
  char_end?: number
  text?: string
}

function classifyCategory(code: string): 'major' | 'minor' | 'extended' | 'school' {
  const upper = code.toUpperCase()
  if (upper.startsWith('MINOR-')) return 'minor'
  if (upper.startsWith('EXTM-')) return 'extended'
  if (upper.startsWith('SREQ-')) return 'school'
  return 'major'
}

/** 把 agent 的判定类型映射到 validation-issues 既有的五种枚举上，不新增枚举值。 */
function issueType(deterministicType: string): string {
  if (deterministicType === 'credits_raw_mismatch') return 'credits_mismatch'
  return 'invariant_failed'
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

async function main() {
  const outArg = process.argv.indexOf('--out')
  const outDir = outArg >= 0 && process.argv[outArg + 1] ? process.argv[outArg + 1] : DEFAULT_OUT

  if (!existsSync(outDir)) {
    throw new Error(`agent 产物目录不存在：${outDir}\n先跑 worker 的 scan + run 生成产物。`)
  }

  const payload = await getPayload({ config })
  let programsWritten = 0
  let programsSkipped = 0
  let chunksWritten = 0
  let issuesWritten = 0

  for (const year of readdirSync(outDir)) {
    const yearDir = path.join(outDir, year)
    if (!/[0-9]{4}-[0-9]{2}/.test(year)) continue

    for (const code of readdirSync(yearDir)) {
      const codeDir = path.join(yearDir, code)
      const requirements = readJson<Rec>(path.join(codeDir, 'requirements.json'))
      const chunksFile = readJson<{ source_pdf?: string; chunks?: ChunkRow[] }>(
        path.join(codeDir, 'chunks.json'),
      )
      const review = readJson<Rec>(path.join(codeDir, 'review.json'))
      if (!requirements) continue

      const programKey = `${year}/${code}`
      const pdfHash = String(review?.pdf_hash ?? '')

      // ---- programs.source ----
      const found = await payload.find({
        collection: 'programs',
        where: { and: [{ year: { equals: year } }, { code: { equals: code } }] },
        limit: 1,
        depth: 0,
      })
      const existing = found.docs[0] as unknown as
        | ({ id: string | number } & { lastPipelineHash?: string | null })
        | undefined

      if (existing) {
        const unchanged =
          pdfHash !== '' && String(existing.lastPipelineHash ?? '') === pdfHash
        if (unchanged) {
          programsSkipped += 1
        } else {
          await payload.update({
            collection: 'programs',
            id: existing.id,
            data: {
              source: requirements,
              lastPipelineHash: pdfHash || null,
            } as never,
          })
          programsWritten += 1
        }
      } else {
        await payload.create({
          collection: 'programs',
          data: {
            year,
            code,
            category: classifyCategory(code),
            title: String(requirements.title ?? ''),
            source: requirements,
            lastPipelineHash: pdfHash || null,
          } as never,
        })
        programsWritten += 1
      }

      // ---- source-chunks ----
      for (const chunk of chunksFile?.chunks ?? []) {
        const hit = await payload.find({
          collection: 'source-chunks',
          where: { chunkId: { equals: chunk.chunk_id } },
          limit: 1,
          depth: 0,
        })
        const row = {
          programKey,
          chunkId: chunk.chunk_id,
          page: chunk.page,
          ordinal: chunk.ordinal,
          charStart: chunk.char_start ?? null,
          charEnd: chunk.char_end ?? null,
          sourcePdf: chunksFile?.source_pdf ?? null,
          text: chunk.text ?? '',
        }
        if (hit.docs.length) {
          await payload.update({
            collection: 'source-chunks',
            id: (hit.docs[0] as { id: string | number }).id,
            data: row as never,
          })
        } else {
          await payload.create({ collection: 'source-chunks', data: row as never })
        }
        chunksWritten += 1
      }

      // ---- validation-issues：先清旧的 agent 条目再重建 ----
      const stale = await payload.find({
        collection: 'validation-issues',
        where: { and: [{ year: { equals: year } }, { code: { equals: code } }] },
        limit: 500,
        depth: 0,
      })
      for (const doc of stale.docs) {
        const detail = (doc as { detail?: Rec }).detail
        if (detail && detail.agent === true) {
          await payload.delete({
            collection: 'validation-issues',
            id: (doc as { id: string | number }).id,
          })
        }
      }

      // 人工已改判的条目不再重建（review.json 是 agent 侧的事实源）
      const resolved = (review?.resolved ?? []) as string[]

      const arbitration = (review?.arbitration ?? {}) as { unresolved?: string[] }
      for (const unresolved of (arbitration.unresolved ?? []).filter(
        (p) => !resolved.includes(p),
      )) {
        await payload.create({
          collection: 'validation-issues',
          data: {
            year,
            code,
            type: 'pipeline_conflict',
            resolved: false,
            detail: { agent: true, programKey, path: unresolved },
          } as never,
        })
        issuesWritten += 1
      }

      const deterministic = (review?.deterministic ?? []) as Array<{
        type: string
        path: string
        detail: string
      }>
      for (const issue of deterministic.filter((d) => !resolved.includes(d.path))) {
        await payload.create({
          collection: 'validation-issues',
          data: {
            year,
            code,
            type: issueType(issue.type),
            resolved: false,
            detail: { agent: true, programKey, path: issue.path, reason: issue.detail },
          } as never,
        })
        issuesWritten += 1
      }
    }
  }

  console.log(
    `[ingest:agent] programs 写入 ${programsWritten} / 跳过 ${programsSkipped}；` +
      `chunks ${chunksWritten}；validation-issues ${issuesWritten}`,
  )
}

main().catch((error: unknown) => {
  console.error(String(error instanceof Error ? error.message : error))
  process.exit(1)
})

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface DeterministicRow {
  type: string
  path: string
  detail: string
}

export interface ReviewSummary {
  year: string
  code: string
  programKey: string
  needsHumanReview: boolean
  unresolved: string[]
  deterministic: DeterministicRow[]
  /** 人工已改判的路径；ingest-agent 会跳过它们，不再重复建 issue */
  resolved: string[]
}

type Rec = Record<string, unknown>

const YEAR_RE = /^\d{4}-\d{2}$/

function reviewPath(outDir: string, year: string, code: string): string {
  return join(outDir, year, code, 'review.json')
}

function toSummary(raw: Rec): ReviewSummary {
  const arbitration = (raw.arbitration ?? {}) as Rec
  return {
    year: String(raw.year ?? ''),
    code: String(raw.code ?? ''),
    programKey: String(raw.program_key ?? ''),
    needsHumanReview: raw.needs_human_review === true,
    unresolved: (arbitration.unresolved as string[] | undefined) ?? [],
    deterministic: (raw.deterministic as DeterministicRow[] | undefined) ?? [],
    resolved: (raw.resolved as string[] | undefined) ?? [],
  }
}

export async function readReview(
  outDir: string,
  year: string,
  code: string,
): Promise<ReviewSummary | null> {
  const file = reviewPath(outDir, year, code)
  if (!existsSync(file)) return null
  return toSummary(JSON.parse(await readFile(file, 'utf8')) as Rec)
}

export async function listReviews(outDir: string): Promise<ReviewSummary[]> {
  if (!existsSync(outDir)) return []

  const out: ReviewSummary[] = []
  for (const year of await readdir(outDir)) {
    if (!YEAR_RE.test(year)) continue
    for (const code of await readdir(join(outDir, year))) {
      const review = await readReview(outDir, year, code)
      if (review) out.push(review)
    }
  }
  return out
}

/**
 * 标记某条分歧已被人工改判。
 *
 * 为什么写回产物文件而不是直接改库：agent 的 validation-issues 每次 ingest
 * 都由 review.json 重建，改库会被下一次 ingest 冲掉。产物文件才是 agent 侧的事实源。
 */
export async function markResolved(
  outDir: string,
  year: string,
  code: string,
  path: string,
): Promise<ReviewSummary> {
  const file = reviewPath(outDir, year, code)
  if (!existsSync(file)) {
    throw new Error(`复核产物不存在：${file}`)
  }

  const raw = JSON.parse(await readFile(file, 'utf8')) as Rec
  const resolved = (raw.resolved as string[] | undefined) ?? []
  if (!resolved.includes(path)) resolved.push(path)
  raw.resolved = resolved

  await writeFile(file, JSON.stringify(raw, null, 1), 'utf8')
  return toSummary(raw)
}

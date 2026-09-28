import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { listReviews, markResolved, readReview } from '../artifacts.js'

async function seedReview(root: string, year: string, code: string, body: unknown) {
  const dir = join(root, year, code)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'review.json'), JSON.stringify(body), 'utf8')
  return dir
}

const REVIEW = {
  year: '2026-27',
  code: 'COMP',
  program_key: '2026-27/COMP',
  needs_human_review: true,
  arbitration: { unresolved: ['groups[0].courses[1].credits'], accepted: [], rejected: [] },
  deterministic: [{ type: 'credits_raw_mismatch', path: 'groups[0].courses[0].credits', detail: '对不上' }],
}

describe('listReviews', () => {
  it('collects every program that produced a review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-artifacts-'))
    await seedReview(root, '2026-27', 'COMP', REVIEW)
    await seedReview(root, '2026-27', 'MATH', { ...REVIEW, code: 'MATH', needs_human_review: false })

    const reviews = await listReviews(root)

    expect(reviews.map((r) => r.code).sort()).toEqual(['COMP', 'MATH'])
    expect(reviews.find((r) => r.code === 'COMP')?.needsHumanReview).toBe(true)
  })

  it('returns empty list when directory is missing', async () => {
    expect(await listReviews(join(tmpdir(), 'nope-xyz-agent'))).toEqual([])
  })
})

describe('readReview', () => {
  it('reads unresolved paths and deterministic issues', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-artifacts-'))
    await seedReview(root, '2026-27', 'COMP', REVIEW)

    const review = await readReview(root, '2026-27', 'COMP')

    expect(review?.unresolved).toEqual(['groups[0].courses[1].credits'])
    expect(review?.deterministic).toHaveLength(1)
  })

  it('treats a missing resolved list as empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-artifacts-'))
    await seedReview(root, '2026-27', 'COMP', REVIEW)

    expect((await readReview(root, '2026-27', 'COMP'))?.resolved).toEqual([])
  })

  it('returns null when the artifact does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-artifacts-'))
    expect(await readReview(root, '2026-27', 'NOPE')).toBeNull()
  })
})

describe('markResolved', () => {
  it('appends the path to resolved and persists it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-artifacts-'))
    await seedReview(root, '2026-27', 'COMP', REVIEW)

    const updated = await markResolved(root, '2026-27', 'COMP', 'groups[0].courses[1].credits')

    expect(updated.resolved).toEqual(['groups[0].courses[1].credits'])
    // 重新读一遍，确认真的落盘了而不是只在内存里
    expect((await readReview(root, '2026-27', 'COMP'))?.resolved).toEqual([
      'groups[0].courses[1].credits',
    ])
  })

  it('does not add the same path twice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-artifacts-'))
    await seedReview(root, '2026-27', 'COMP', REVIEW)

    await markResolved(root, '2026-27', 'COMP', 'groups[0].courses[1].credits')
    const again = await markResolved(root, '2026-27', 'COMP', 'groups[0].courses[1].credits')

    expect(again.resolved).toEqual(['groups[0].courses[1].credits'])
  })

  it('throws when the review does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-artifacts-'))
    await expect(markResolved(root, '2026-27', 'NOPE', 'x')).rejects.toThrow(/不存在/)
  })
})

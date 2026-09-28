import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildSingletonKey,
  classifyCategory,
  hashFile,
  parseCodeFromFilename,
  scanPdfRoot,
} from '../scanner.js'

describe('parseCodeFromFilename', () => {
  it('takes the leading token as program code', () => {
    expect(parseCodeFromFilename('COMP_BEng_in_Computer_Science.pdf')).toBe('COMP')
    expect(parseCodeFromFilename('MATH_BSc_in_Mathematics.pdf')).toBe('MATH')
  })

  it('keeps prefixed codes such as MINOR-/EXTM-', () => {
    expect(parseCodeFromFilename('MINOR-CS_BSc_in_Computing.pdf')).toBe('MINOR-CS')
  })

  it('returns null for non-pdf or malformed names', () => {
    expect(parseCodeFromFilename('index.json')).toBeNull()
    expect(parseCodeFromFilename('COMP.pdf')).toBeNull()
    expect(parseCodeFromFilename('')).toBeNull()
  })
})

describe('classifyCategory', () => {
  it('maps code prefixes to output categories', () => {
    expect(classifyCategory('COMP')).toBe('major')
    expect(classifyCategory('MINOR-CS')).toBe('minor')
    expect(classifyCategory('EXTM-AI')).toBe('extended')
    expect(classifyCategory('SREQ-ENG')).toBe('school')
  })
})

describe('buildSingletonKey', () => {
  it('is stable for the same inputs and changes with the pdf hash', () => {
    const a = buildSingletonKey('2026-27', 'COMP', 'abc123')
    expect(a).toBe(buildSingletonKey('2026-27', 'COMP', 'abc123'))
    expect(a).not.toBe(buildSingletonKey('2026-27', 'COMP', 'deadbeef'))
  })
})

describe('hashFile', () => {
  it('changes when file content changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-hash-'))
    const path = join(dir, 'a.pdf')
    await writeFile(path, 'v1')
    const first = await hashFile(path)
    await writeFile(path, 'v2')
    const second = await hashFile(path)

    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(first).not.toBe(second)
  })
})

describe('scanPdfRoot', () => {
  it('collects pdfs with year taken from the directory name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-scan-'))
    await mkdir(join(root, 'major', '2026-27'), { recursive: true })
    await writeFile(join(root, 'major', '2026-27', 'COMP_BEng_in_CS.pdf'), 'pdf-a')
    await writeFile(join(root, 'major', '2026-27', 'MATH_BSc_in_Math.pdf'), 'pdf-b')

    const jobs = await scanPdfRoot(root)

    expect(jobs).toHaveLength(2)
    expect(jobs.map((j) => j.code).sort()).toEqual(['COMP', 'MATH'])
    expect(jobs.every((j) => j.year === '2026-27')).toBe(true)
    expect(jobs.every((j) => j.category === 'major')).toBe(true)
  })

  it('ignores files outside a year directory and non-pdf files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-scan-'))
    await mkdir(join(root, 'major', '2026-27'), { recursive: true })
    await mkdir(join(root, 'major', 'not-a-year'), { recursive: true })
    await writeFile(join(root, 'major', '2026-27', 'COMP_BEng_in_CS.pdf'), 'pdf-a')
    await writeFile(join(root, 'major', 'not-a-year', 'PHYS_BSc_in_Phys.pdf'), 'pdf-x')
    await writeFile(join(root, 'major', '2026-27', 'index.json'), '{}')

    const jobs = await scanPdfRoot(root)

    expect(jobs.map((j) => j.code)).toEqual(['COMP'])
  })

  it('gives each job a distinct singleton key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-scan-'))
    await mkdir(join(root, 'major', '2026-27'), { recursive: true })
    await writeFile(join(root, 'major', '2026-27', 'COMP_BEng_in_CS.pdf'), 'pdf-a')
    await writeFile(join(root, 'major', '2026-27', 'MATH_BSc_in_Math.pdf'), 'pdf-b')

    const jobs = await scanPdfRoot(root)
    const keys = new Set(jobs.map((j) => j.singletonKey))

    expect(keys.size).toBe(jobs.length)
  })

  it('returns empty list when root does not exist', async () => {
    expect(await scanPdfRoot(join(tmpdir(), 'definitely-not-here-xyz'))).toEqual([])
  })
})

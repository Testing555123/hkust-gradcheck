import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export type Category = 'major' | 'minor' | 'extended' | 'school'

export interface ExtractJob {
  year: string
  code: string
  category: Category
  /** PDF 绝对路径（只用于 spawn Python，不入库——gates.ts 拒绝绝对路径） */
  pdfPath: string
  /** 内容哈希前 16 位：PDF 变了才会重新处理 */
  pdfHash: string
  /** pg-boss 去重键，保证同一份 PDF 不会重复入队 */
  singletonKey: string
}

const YEAR_DIR_RE = /^\d{4}-\d{2}$/
const HASH_LENGTH = 16

/**
 * 从文件名取专业代码：`<CODE>_<Degree>_in_<Program>.pdf` -> CODE。
 * 前缀形式（MINOR-CS / EXTM-AI / SREQ-ENG）要原样保留，分类靠它。
 */
export function parseCodeFromFilename(filename: string): string | null {
  if (!filename.toLowerCase().endsWith('.pdf')) return null
  const stem = filename.slice(0, -'.pdf'.length)
  const split = stem.indexOf('_')
  if (split <= 0) return null
  return stem.slice(0, split)
}

export function classifyCategory(code: string): Category {
  const upper = code.toUpperCase()
  if (upper.startsWith('MINOR-')) return 'minor'
  if (upper.startsWith('EXTM-')) return 'extended'
  if (upper.startsWith('SREQ-')) return 'school'
  return 'major'
}

export function buildSingletonKey(year: string, code: string, pdfHash: string): string {
  return `extract:${year}:${code}:${pdfHash}`
}

export async function hashFile(path: string): Promise<string> {
  const content = await readFile(path)
  return createHash('sha1').update(content).digest('hex').slice(0, HASH_LENGTH)
}

async function collectYearDirs(root: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return // 根目录不存在时静默返回，scan 命令负责给出可读提示
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(root, entry.name)
    if (YEAR_DIR_RE.test(entry.name)) out.push(full)
    else await collectYearDirs(full, out)
  }
}

/**
 * 扫描 PDF 根目录，产出待处理任务。
 *
 * 学年取自**目录名**（与 run_pipeline 的 discover 一致），代码取自文件名。
 * 不在学年目录下的文件一律忽略——那些通常是索引或临时文件。
 */
export async function scanPdfRoot(root: string): Promise<ExtractJob[]> {
  const yearDirs: string[] = []
  await collectYearDirs(root, yearDirs)
  yearDirs.sort()

  const jobs: ExtractJob[] = []
  for (const dir of yearDirs) {
    const year = basename(dir)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const code = parseCodeFromFilename(entry.name)
      if (!code) continue

      const pdfPath = join(dir, entry.name)
      const pdfHash = await hashFile(pdfPath)
      jobs.push({
        year,
        code,
        category: classifyCategory(code),
        pdfPath,
        pdfHash,
        singletonKey: buildSingletonKey(year, code, pdfHash),
      })
    }
  }

  return jobs
}

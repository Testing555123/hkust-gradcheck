import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url))
export const WORKER_DIR = join(SRC_DIR, '..')
export const PROJECT_ROOT = join(WORKER_DIR, '..', '..')
export const PIPELINE_DIR = join(PROJECT_ROOT, 'pipeline')

// 与 studio 共用同一份 .env（DATABASE_URL / PAYLOAD_SECRET / WORKER_* 都在那里），
// 不在 worker 目录再放一份，避免两处配置漂移。
loadEnv({ path: join(PROJECT_ROOT, 'apps', 'studio', '.env') })
export const DEFAULT_OUT_DIR = join(PIPELINE_DIR, 'output', 'agent')

export interface WorkerConfig {
  /** 仅 scan / run / status 需要；review 只读产物文件，不该被它挡住 */
  databaseUrl: string | null
  pdfRoot: string
  outDir: string
  pythonBin: string
  parser: string
  concurrency: number
  maxAttempts: number
  /** drain 模式下连续空闲多久判定队列已排空（毫秒） */
  idleMs: number
}

function num(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function loadConfig(): WorkerConfig {
  // pg-boss 与 Payload 共用同一个 Postgres；队列 schema 由 pg-boss 自建。
  // 这里不抛错：review 子命令不需要连库，缺了也应该能用。
  const databaseUrl = process.env.DATABASE_URL || null

  return {
    databaseUrl,
    pdfRoot: process.env.WORKER_PDF_ROOT || join(PROJECT_ROOT, 'unpress_pdf'),
    outDir: process.env.WORKER_OUT_DIR || DEFAULT_OUT_DIR,
    pythonBin: process.env.WORKER_PYTHON || 'py',
    parser: process.env.WORKER_PARSER || 'pymupdf',
    // PDF 解析是 CPU 密集，并发开高反而拖慢；默认保守
    concurrency: num(process.env.WORKER_CONCURRENCY, 2),
    maxAttempts: num(process.env.WORKER_MAX_ATTEMPTS, 3),
    idleMs: num(process.env.WORKER_IDLE_MS, 15_000),
  }
}

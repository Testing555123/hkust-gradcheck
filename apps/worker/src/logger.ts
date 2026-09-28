import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { PROJECT_ROOT } from './config.js'

const LOGS_DIR = join(PROJECT_ROOT, 'logs')

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 结构化日志：一行一条 JSON，落到 logs/agent-<date>.jsonl。
 *
 * 只记 jobId / year / code / stage / durationMs 这类元数据，
 * **绝不 dump 原文**——批量跑 255 份时全文会把日志撑爆。
 */
export async function log(
  event: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields })
  console.log(line)
  try {
    await mkdir(LOGS_DIR, { recursive: true })
    await appendFile(join(LOGS_DIR, `agent-${stamp()}.jsonl`), `${line}\n`, 'utf8')
  } catch {
    // 日志写失败不该让任务失败
  }
}

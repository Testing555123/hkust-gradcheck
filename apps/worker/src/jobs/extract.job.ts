import { spawn } from 'node:child_process'

import type { WorkerConfig } from '../config.js'
import { PIPELINE_DIR } from '../config.js'
import { log } from '../logger.js'
import type { ExtractJob } from '../scanner.js'

export interface ExtractOutcome {
  year: string
  code: string
  category: string
  outDir: string
  durationMs: number
}

function runPython(args: string[], config: WorkerConfig, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows 控制台默认 cp950/GBK，子进程打印中文会直接 UnicodeEncodeError 崩掉。
      // 强制 UTF-8 才能让管线在任何终端环境下都稳定（实测踩坑）。
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`python 退出码 ${code}\n${output.trim()}`))
    })
  })
}

/**
 * 单份 PDF 的端到端编排：调用 Python 侧的双 pass 管线，收产物路径。
 *
 * 两个进程之间靠**文件产物目录**衔接，不起 HTTP 服务：
 * Python 侧已有 MinerU/pymupdf 解析器与 255 份存量产物，重写进 Node 不划算；
 * Node 侧要 Payload Local API 和 pg-boss，也不适合搬去 Python。
 */
export async function runExtractJob(
  job: ExtractJob,
  config: WorkerConfig,
): Promise<ExtractOutcome> {
  const startedAt = Date.now()
  const outDir = `${config.outDir}/${job.year}/${job.code}`

  await log('job_start', {
    jobId: job.singletonKey,
    year: job.year,
    code: job.code,
    category: job.category,
  })

  const output = await runPython(
    [
      '-m',
      'agents.run_agents',
      '--year',
      job.year,
      '--code',
      job.code,
      '--pdf',
      job.pdfPath,
      '--pdf-hash',
      job.pdfHash,
      '--parser',
      config.parser,
      '--out-dir',
      config.outDir,
    ],
    config,
    PIPELINE_DIR,
  )

  const durationMs = Date.now() - startedAt
  await log('job_done', {
    jobId: job.singletonKey,
    year: job.year,
    code: job.code,
    durationMs,
    tail: output.trim().split('\n').slice(-1)[0] ?? '',
  })

  return {
    year: job.year,
    code: job.code,
    category: job.category,
    outDir,
    durationMs,
  }
}

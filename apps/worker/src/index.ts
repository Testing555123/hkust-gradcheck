import { existsSync } from 'node:fs'

import { listReviews, markResolved, readReview } from './artifacts.js'
import { createBoss, enqueueExtract, QUEUE_NAME } from './boss.js'
import type { WorkerConfig } from './config.js'
import { loadConfig } from './config.js'
import { runExtractJob } from './jobs/extract.job.js'
import { log } from './logger.js'
import { writebackAndRecompute } from './recompute.js'
import { scanPdfRoot } from './scanner.js'
import type { ExtractJob } from './scanner.js'

/**
 * agent CLI
 *
 *   agent scan    扫描 PDF 目录并入队（singletonKey 去重，同一份不会重复跑）
 *   agent run     消费队列，排空后自动退出（供定时任务调用）
 *   agent status  查看队列状态
 *
 * 定时任务推荐写法：先 scan 再 run，幂等且可重复执行。
 */
async function cmdScan(config: WorkerConfig): Promise<void> {
  if (!existsSync(config.pdfRoot)) {
    throw new Error(
      `PDF 根目录不存在：${config.pdfRoot}\n` +
        '设置 WORKER_PDF_ROOT 指向毕业要求 PDF 所在目录（各学年子目录形如 2026-27）。',
    )
  }

  const jobs = await scanPdfRoot(config.pdfRoot)
  if (jobs.length === 0) {
    console.log(`未扫描到任何 PDF：${config.pdfRoot}`)
    return
  }

  const boss = await createBoss(config)
  try {
    let queued = 0
    for (const job of jobs) {
      const id = await enqueueExtract(boss, job, config)
      if (id) queued += 1 // 返回 null 表示 singletonKey 命中，已在队列里
    }
    await log('scan_done', { scanned: jobs.length, queued, skipped: jobs.length - queued })
    console.log(`扫描 ${jobs.length} 份 PDF，入队 ${queued} 条，跳过 ${jobs.length - queued} 条（已存在）`)
  } finally {
    await boss.stop()
  }
}

async function cmdRun(config: WorkerConfig): Promise<void> {
  const boss = await createBoss(config)
  let active = 0
  let lastActivityAt = Date.now()

  try {
    // handler 收到的是**批次**（数组），即使 batchSize=1 也是数组
    await boss.work(QUEUE_NAME, { localConcurrency: config.concurrency }, async (jobs) => {
      for (const job of jobs) {
        active += 1
        lastActivityAt = Date.now()
        try {
          const data = job.data as ExtractJob
          await runExtractJob(data, config)
        } finally {
          active -= 1
          lastActivityAt = Date.now()
        }
      }
    })

    // 排空检测：连续 idleMs 没有任务在跑，认为队列已空，退出进程。
    // 定时任务需要「跑完就退出」，不能常驻。
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (active === 0 && Date.now() - lastActivityAt > config.idleMs) {
          clearInterval(timer)
          resolve()
        }
      }, 2_000)
    })

    await log('run_drained', { idleMs: config.idleMs })
    console.log('队列已排空，开始写库与 derived 回环')

    // 整批跑完再写库一次（而不是每份都写）：baker 与 db:ingest 是全量重算，
    // 每份触发一次等于把 255 份重复烘焙 255 遍。
    await writebackAndRecompute(config.outDir)
    console.log('写库与 derived 回环完成')
  } finally {
    await boss.stop()
  }
}

async function cmdStatus(config: WorkerConfig): Promise<void> {
  const boss = await createBoss(config)
  try {
    const queues = await boss.getQueues([QUEUE_NAME])
    console.log(JSON.stringify(queues, null, 2))
  } finally {
    await boss.stop()
  }
}

/**
 * 人工复核（第一版不做 UI，只给 CLI）：
 *
 *   agent review list                     列出所有待复核的专业
 *   agent review show 2026-27 COMP        看某份的分歧明细
 *   agent review resolve 2026-27 COMP <path>   标记某条已改判
 */
async function cmdReview(config: WorkerConfig): Promise<void> {
  const [action = 'list', year, code, path] = process.argv.slice(3)

  if (action === 'list') {
    const reviews = await listReviews(config.outDir)
    const pending = reviews.filter((r) => r.needsHumanReview || r.deterministic.length > 0)
    if (pending.length === 0) {
      console.log('没有待复核项')
      return
    }
    for (const review of pending) {
      const outstanding = [...review.unresolved, ...review.deterministic.map((d) => d.path)].filter(
        (p) => !review.resolved.includes(p),
      )
      console.log(
        `${review.year}\t${review.code}\t待处理 ${outstanding.length}` +
          (review.needsHumanReview ? '\t[需人工]' : ''),
      )
      for (const item of outstanding) console.log(`    ${item}`)
    }
    return
  }

  if (action === 'show') {
    const review = await readReview(config.outDir, year ?? '', code ?? '')
    if (!review) throw new Error(`没有 ${year} ${code} 的复核产物`)
    console.log(JSON.stringify(review, null, 2))
    return
  }

  if (action === 'resolve') {
    if (!year || !code || !path) {
      throw new Error('用法：agent review resolve <year> <code> <path>')
    }
    const updated = await markResolved(config.outDir, year, code, path)
    console.log(`已标记改判：${path}\n当前 resolved：${updated.resolved.join(', ')}`)
    return
  }

  throw new Error(`未知 review 动作：${action}（可用：list / show / resolve）`)
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status'
  const config = loadConfig()

  switch (command) {
    case 'scan':
      await cmdScan(config)
      break
    case 'run':
      await cmdRun(config)
      break
    case 'status':
      await cmdStatus(config)
      break
    case 'review':
      await cmdReview(config)
      break
    default:
      throw new Error(`未知子命令：${command}（可用：scan / run / status / review）`)
  }
}

main().catch((error: unknown) => {
  console.error(String(error instanceof Error ? error.message : error))
  process.exit(1)
})

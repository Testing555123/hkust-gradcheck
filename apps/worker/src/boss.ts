import { PgBoss } from 'pg-boss'

import type { WorkerConfig } from './config.js'

export const QUEUE_NAME = 'extract'

/**
 * pg-boss 单例。
 *
 * 为什么不用手写队列表：pg-boss 自带 SKIP LOCKED 抢占、指数退避重试、
 * 死信队列、singletonKey 去重和并发控制——这些自己写一遍就是几百行，
 * 而且是「每份 PDF 都要赌它对不对」的核心路径。
 */
export async function createBoss(config: WorkerConfig): Promise<PgBoss> {
  if (!config.databaseUrl) {
    throw new Error('缺少 DATABASE_URL：pg-boss 需要它来建队列表（review 子命令不需要）')
  }

  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    // 与 Payload 共用 Neon 免费档，队列独占一个小池，别和 Payload 抢连接
    max: 5,
    application_name: 'newone-agent-worker',
  })

  boss.on('error', (error) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'boss_error', error: String(error) }))
  })

  await boss.start()
  await boss.createQueue(QUEUE_NAME)
  return boss
}

export async function enqueueExtract(
  boss: PgBoss,
  job: { year: string; code: string; singletonKey: string; pdfPath: string; pdfHash: string; category: string },
  config: WorkerConfig,
): Promise<string | null> {
  return boss.send(
    QUEUE_NAME,
    job,
    {
      singletonKey: job.singletonKey,
      // 同一份 PDF 在队列里只保留一条：每天定时扫到同一份不会重复跑
      singletonSeconds: 24 * 60 * 60,
      retryLimit: config.maxAttempts,
      retryDelay: 30,
      retryBackoff: true,
    },
  )
}

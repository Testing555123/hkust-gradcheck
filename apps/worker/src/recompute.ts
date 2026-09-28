import { spawn } from 'node:child_process'

import { PROJECT_ROOT } from './config.js'
import { log } from './logger.js'

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows 上 npm 是 .cmd，Node >= 20 不带 shell 直接 spawn 会 ENOENT（实测踩坑）
      shell: process.platform === 'win32',
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
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}\n${output.trim()}`))
    })
  })
}

/**
 * derived 回环。
 *
 * ingest-baked.ts 顶部已如实记录：「后台改 source 后 derived 不会自动重算」。
 * 而学生端读的是 derived——不跑这一步，agent 写进去的修正对外根本不可见。
 *
 * 三步必须串行：写库 -> 烘焙（Python，口径唯一）-> 回灌 derived。
 */
export async function writebackAndRecompute(outDir: string): Promise<void> {
  const startedAt = Date.now()
  await log('writeback_start', { outDir })

  await run('npm', ['-w', '@newone/studio', 'run', 'ingest:agent', '--', '--out', outDir])

  await log('baker_start')
  await run('python', ['scripts/export_static_data.py'])

  await log('ingest_start')
  await run('npm', ['run', 'db:ingest'])

  await log('writeback_done', { durationMs: Date.now() - startedAt })
}

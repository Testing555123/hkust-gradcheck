/**
 * L4 闸门自检：对 §5 不变量「故意破坏」，要求每一条都真的拦住。
 * 跑法：npm -w @newone/studio run gates:selftest   （非 0 退出 = 有闸门失效）
 *
 * 用 local API 是因为它绕过访问控制但**不绕过 hooks** —— 正好只测闸门本身。
 */
import 'dotenv/config'
import { getPayload } from 'payload'

import config from './payload.config'

const payload = await getPayload({ config })
const one = await payload.find({ collection: 'programs', limit: 1, depth: 0 })
const base = one.docs[0] as unknown as Record<string, unknown>

type Case = { name: string; mode: 'create' | 'update'; data: Record<string, unknown>; expect: string | null }
const CASES: Case[] = [
  {
    name: '隐私：source_pdf 为本机绝对路径（Windows）',
    mode: 'update',
    data: { source: { ...(base.source as object), source_pdf: 'C:\\Users\\dongdong\\secrets\\plan.pdf' } },
    expect: '绝对路径',
  },
  {
    name: '隐私：source_pdf 为 POSIX 绝对路径',
    mode: 'update',
    data: { source: { ...(base.source as object), source_pdf: '/home/ci/build/unpress_pdf/x.pdf' } },
    expect: '绝对路径',
  },
  {
    name: '结构：要求组缺 name',
    mode: 'update',
    data: { source: { ...(base.source as object), groups: [{ required_credits: 6 }] } },
    expect: '缺 name',
  },
  {
    name: '结构：组内课程缺 code',
    mode: 'update',
    data: { source: { ...(base.source as object), groups: [{ name: 'X', courses: [{ credits: 3 }] }] } },
    expect: '缺 code',
  },
  {
    name: '必填：新建时缺 code',
    mode: 'create',
    data: { year: '2099-00', category: 'major', source: { groups: [{ name: 'A', required_credits: 1 }] } },
    expect: 'code 有效值缺失',
  },
  {
    name: '必填：把 code 改成空串',
    mode: 'update',
    data: { code: '   ' },
    expect: 'code 有效值',
  },
  {
    // 反向控制：部分更新不带 code，必须放行（否则后台每次局部编辑都会被误杀）
    name: '不误伤：部分更新不带 code',
    mode: 'update',
    data: { title: '自测：只改标题' },
    expect: null,
  },
]

let failed = 0
for (const c of CASES) {
  let caught: string | null = null
  try {
    if (c.mode === 'create') await payload.create({ collection: 'programs', data: c.data })
    else await payload.update({ collection: 'programs', id: base.id as string, data: c.data })
  } catch (err) {
    caught = (err as Error).message
  }
  if (c.expect === null) {
    const ok = caught === null
    if (!ok) failed++
    console.log(`  ${ok ? '✅ 放行' : '❌ 误杀'}  ${c.name}${caught ? `\n         意外报错: ${caught.split('\n')[0].slice(0, 90)}` : ''}`)
    continue
  }
  const blocked = caught !== null && caught.includes(c.expect)
  if (!blocked) failed++
  console.log(`  ${blocked ? '✅ 拦住' : '❌ 漏放'}  ${c.name}`)
  if (caught) console.log(`         报错首行: ${caught.split('\n')[0].slice(0, 90)}`)
  else console.log(`         ⚠️ 写入竟然成功了 —— 闸门失效`)
}

// 反向确认：闸门没有误伤正常数据
const ok = await payload.update({
  collection: 'programs',
  id: base.id as string,
  data: { ...base, revision: Number(base.revision ?? 1) + 1 },
})
console.log(`  ${ok?.id ? '✅ 未误伤' : '❌ 误伤'}  正常改写应当通过（revision -> ${(ok as any).revision}）`)

// ---- 版本与回滚：选 Payload 而非 PocketBase 的唯一理由，必须实证 ----
console.log('\n[版本/回滚]')
const docId = base.id as string
const stamp = '自测-' + Date.now()
await payload.update({ collection: 'programs', id: docId, data: { title: stamp + ' A' } })
await payload.update({ collection: 'programs', id: docId, data: { title: stamp + ' B' } })
const versions = (await payload.findVersions({
  collection: 'programs',
  where: { parent: { equals: docId } },
  sort: 'createdAt',
  limit: 20,
  depth: 0,
})).docs as unknown as { id: string; version?: { title?: string }; updatedBy?: unknown }[]
console.log(`  版本条数: ${versions.length}（期望 >= 2）；标题轨迹: ${versions.map((v) => v.version?.title).join(' -> ')}`)
// 版本会跨次运行累积，所以不能拿"最早那条"；按标题定位本次写入的版本，才是确定性的。
const wantA = stamp + ' A'
const target = versions.find((v) => v.version?.title === wantA)
let reverted: string | undefined
if (target) {
  const restored = (await payload.restoreVersion({ collection: 'programs', id: target.id, depth: 0 })) as unknown as {
    title?: string
  }
  reverted = restored?.title
} else {
  reverted = '(未找到本次 A 的版本记录)'
}
const okRestore = reverted === wantA
if (!okRestore) failed++
console.log(`  ${okRestore ? '✅' : '❌'} restoreVersion 回滚到最早版本: 得到 ${JSON.stringify(reverted)}，期望 ${JSON.stringify(wantA)}`)
const whoChanged = versions[0]?.updatedBy ?? null
console.log(`  ℹ️ 版本记录里的改动者字段: ${JSON.stringify(whoChanged)}（null = 本地 API 无用户上下文，浏览器改动才会带 user）`)

console.log(failed ? `\n[FAIL] ${failed} 项未达预期` : '\n[ok] 全部闸门按 §5 语义拦住、未误伤正常数据，且版本回滚可用')
process.exit(failed ? 1 : 0)

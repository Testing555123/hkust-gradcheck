/**
 * T7（复用路线）：把烘焙器的产物写进 DB，而不是在 Node 里重算派生。
 *
 * 为什么不重算：派生逻辑实测 1,300 行 Python（combo_rules.py 429 +
 * export_static_data.py 740 + branch_rules.py 131）。把它移植成 TS 属于
 * 领域文档 §8.4 明确排到最后、且 §8.1 要求"原样带走"的那一类高风险动作 ——
 * 组合解析一旦在新语言里悄悄算 differently，改变的就是"学生还差几学分"的结论。
 *
 * 所以本脚本只做搬运：derived 直接取烘焙成品（与静态站发出的字节同源），
 * 顺带补齐 courses / course-refs / metas / common-core-maps 四个空集合。
 *
 * 已知限制（诚实记录）：后台改 source 后 derived 不会自动重算，
 * 必须再跑一次 baker + 本脚本。要"保存即生效"只有两条路：
 *   (a) T9 双写回环 + CI 重烘焙（复用 Python，口径唯一）—— 设计推荐
 *   (b) 把 1,300 行移植成 TS 并用 255 份产物做黄金对拍门 —— 昂贵
 * 跑法：npm -w @newone/studio run ingest
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import 'dotenv/config'
import { getPayload } from 'payload'

import config from './payload.config'
import type { Meta, Program } from './payload-types'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const DATA = path.join(REPO, 'frontend/public/data')
const read = (p: string) => JSON.parse(readFileSync(path.join(DATA, p), 'utf8')) as unknown

type Rec = Record<string, unknown>
type Json = NonNullable<Meta['counts']>
// 烘焙产物的实测形状（courses.json 全 1144 门、course_index.json 全 1344 桶都验证过）
type BakedCourse = { code: string; title: string; credits: string; prerequisites: string; offered_semesters: string }
type BakedBucket = { total: number; items: Rec[] }

async function main() {
  const payload = await getPayload({ config })
  const index = read('index.json') as Rec[]
  const meta = read('meta.json') as Rec
  const courses = read('courses.json') as BakedCourse[]
  const courseIndex = read('course_index.json') as Record<string, BakedBucket>

  // ---- programs.derived ----
  let derivedOk = 0
  let derivedMissing = 0
  for (const entry of index) {
    const year = String(entry.year)
    const code = String(entry.code)
    const tree = read(`programs/${year}_${code}.json`) as { program: Rec; groups: Rec[] }
    const found = await payload.find({
      collection: 'programs',
      where: { and: [{ year: { equals: year } }, { code: { equals: code } }] },
      limit: 1, depth: 0,
    })
    if (!found.docs.length) { derivedMissing++; continue }
    const doc = found.docs[0] as unknown as Program
    await payload.update({
      collection: 'programs',
      id: doc.id,
      // 整份烘焙产物原样存入：{program, groups}，与静态站字节同源
      data: { derived: tree as unknown as Program['derived'] },
    })
    derivedOk++
  }

  // ---- courses ----
  let coursesOk = 0
  for (const c of courses) {
    const raw = String(c.credits ?? '')
    const parsed = raw.match(/\d+/)
    const found = await payload.find({ collection: 'courses', where: { code: { equals: c.code } }, limit: 1, depth: 0 })
    const data = {
      code: String(c.code),
      title: c.title,
      creditsRaw: raw,
      credits: parsed ? Number(parsed[0]) : undefined,
      level: Number((String(c.code).match(/\d{4}/)?.[0] ?? '0').slice(0, 3) + '00'),
      prerequisites: c.prerequisites,
      offeredSemesters: c.offered_semesters,
    }
    if (found.docs.length) await payload.update({ collection: 'courses', id: found.docs[0].id, data })
    else await payload.create({ collection: 'courses', data })
    coursesOk++
  }

  // ---- course-refs：实测 1344 个课号，其中 558 个不在课程库，故 courseCode 只能是 text ----
  let refsOk = 0
  for (const [courseCode, bucket] of Object.entries(courseIndex)) {
    const found = await payload.find({ collection: 'course-refs', where: { courseCode: { equals: courseCode } }, limit: 1, depth: 0 })
    const data = { courseCode, refs: bucket.items, total: bucket.total }
    if (found.docs.length) await payload.update({ collection: 'course-refs', id: found.docs[0].id, data })
    else await payload.create({ collection: 'course-refs', data })
    refsOk++
  }

  // ---- metas + common-core-maps ----
  // index.json 是跨语料聚合（255 条摘要），不能由单文档拼出来，故整份存成一行 meta。
  const upsertMeta = async (key: string, counts: Json) => {
    const found = await payload.find({ collection: 'metas', where: { key: { equals: key } }, limit: 1, depth: 0 })
    const data = { key, generatedAt: String(meta.generated_at ?? ''), counts }
    if (found.docs.length) await payload.update({ collection: 'metas', id: found.docs[0].id, data })
    else await payload.create({ collection: 'metas', data })
  }
  await upsertMeta('current', meta)
  await upsertMeta('program-index', index)
  await upsertMeta('course-index', courseIndex)

  const mapPath = path.join(REPO, 'packages/domain/src/data/common-core-course-map.json')
  const mapJson = JSON.parse(readFileSync(mapPath, 'utf8')) as Rec
  const admissionYears = [...new Set(Object.keys(mapJson).filter(k => /^\d{4}-\d{2}$/.test(k)))]
  for (const y of admissionYears.length ? admissionYears : ['all']) {
    const found = await payload.find({ collection: 'common-core-maps', where: { admissionYear: { equals: y } }, limit: 1, depth: 0 })
    const data = { admissionYear: y, map: ((mapJson as Rec)[y] ?? mapJson) as Json }
    if (found.docs.length) await payload.update({ collection: 'common-core-maps', id: found.docs[0].id, data })
    else await payload.create({ collection: 'common-core-maps', data })
  }

  // ---- 断言 ----
  // 字段名实测为 totalDocs（Payload 3）：前两版分别按 count().total 与 find().total
  // 取值，打出 undefined 却仍让 [ok] 通过 —— 断言与展示必须同源，故此处统一走 count()。
  const totalOf = async (slug: 'programs' | 'courses' | 'course-refs' | 'metas') =>
    (await payload.count({ collection: slug })).totalDocs
  const counts = {
    programs: await totalOf('programs'),
    courses: await totalOf('courses'),
    refs: await totalOf('course-refs'),
    metas: await totalOf('metas'),
  }
  const derivedTotal = (await payload.count({
    collection: 'programs', where: { derived: { exists: true } },
  })).totalDocs
  console.log(`[ingest] derived 写入 ${derivedOk} 份（缺文档 ${derivedMissing}）`)
  console.log(`[ingest] courses ${coursesOk} 门 · course-refs ${refsOk} 个课号 · metas ${counts.metas} · 通识映射 ${admissionYears.length || 1} 份`)
  console.log(`[断言] DB 计数 programs=${counts.programs} courses=${counts.courses} courseRefs=${counts.refs} metas=${counts.metas} 含derived=${derivedTotal}`)
  const ok = derivedOk === 255 && derivedMissing === 0 && coursesOk === 1144 && refsOk === 1344
    && counts.programs === 255 && counts.courses === 1144 && counts.refs === 1344
    && counts.metas === 3 && derivedTotal === 255
  console.log(ok ? '[ok] T7 搬运完成：255 derived / 1144 courses / 1344 refs / 3 metas' : '[FAIL] 计数未达预期')
  process.exit(ok ? 0 : 1)
}

await main()

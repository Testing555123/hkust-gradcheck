#!/usr/bin/env node
/**
 * T11 等价性对拍：API 数据源与静态文件必须给出**语义相同**的数据。
 *
 * 判据为什么是"解析后深度相等"而不是"逐字节相同"：
 *   学生端消费的是解析后的对象；键顺序/缩进/`22.0` vs `22` 不影响行为。
 *   但差异不会被藏起来 —— 本脚本同时报告字节差异数与首个语义差异路径。
 *
 * 跑法：node scripts/check_site_parity.mjs [base]     默认 http://127.0.0.1:3200
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const BASE = (process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3200').replace(/\/$/, '')
const DATA = path.resolve(import.meta.dirname, '../frontend/public/data')
const read = (p) => readFileSync(path.join(DATA, p), 'utf8')

// 全量而非抽样：index.json 就是 255 份树的清单，抽样会让"漏掉的那一份"恰好是坏的那一份。
const ALL_TREES = JSON.parse(read('index.json')).map((e) => `${e.year}_${e.code}`)
const CONCURRENCY = 16

function diffFirst(a, b, p = '$') {
  if (a === b) return null
  if (typeof a !== typeof b) return `${p}: 类型 ${typeof a} vs ${typeof b}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: 数组性不一致`
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b || {})])
    for (const k of keys) {
      const d = diffFirst(a[k], b?.[k], `${p}.${k}`)
      if (d) return d
    }
    return null
  }
  return `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
}

let failures = 0
/** 返回是否一致：并发下不能用"共享计数器的前后差"来判断，否则失败会记到错误的样本上。 */
async function compare(label, staticPath, apiUrl, quiet = false) {
  const staticText = read(staticPath)
  let res
  try {
    res = await fetch(BASE + apiUrl)
  } catch (e) {
    console.log(`  ❌ ${label.padEnd(30)} 请求失败 ${e.message}`)
    failures++
    return false
  }
  if (!res.ok) {
    console.log(`  ❌ ${label.padEnd(30)} HTTP ${res.status}`)
    failures++
    return false
  }
  const apiText = await res.text()
  const same = apiText === staticText
  let semantic = null
  try {
    semantic = diffFirst(JSON.parse(staticText), JSON.parse(apiText))
  } catch (e) {
    semantic = `解析失败 ${e.message}`
  }
  const ok = semantic === null
  if (!ok) failures++
  if (!quiet || !ok) {
    console.log(
      `  ${ok ? '✅' : '❌'} ${label.padEnd(30)} 语义${ok ? '一致' : '不一致'}  ` +
      `字节${same ? '相同' : `不同(${(apiText.length / 1024).toFixed(0)}KB vs ${(staticText.length / 1024).toFixed(0)}KB)`}  ` +
      `${(staticText.length / 1024).toFixed(0)}KB` + (ok ? '' : `\n      首个差异 ${semantic}`),
    )
  }
  return ok
}

console.log(`\n=== 数据源对拍：/api/site/* vs frontend/public/data ===\n  基址 ${BASE}\n`)
await compare('index.json', 'index.json', '/api/site/index')
await compare('courses.json', 'courses.json', '/api/site/courses')
await compare('course_index.json', 'course_index.json', '/api/site/course-index')
console.log(`  —— 方案树全量 ${ALL_TREES.length} 份（并发 ${CONCURRENCY}，只列不一致的）——`)
// 全量 255 份串行慢一个量级；并发 CONCURRENCY 实测仍是秒级，失败仍会逐项列出。
const treeResults = []
for (let i = 0; i < ALL_TREES.length; i += CONCURRENCY) {
  treeResults.push(...await Promise.all(ALL_TREES.slice(i, i + CONCURRENCY).map(async (t) => {
    const [year, ...rest] = t.split('_')
    return compare(t, `programs/${t}.json`, `/api/site/program/${year}/${rest.join('_')}`, true)
  })))
}
const treesOk = treeResults.filter(Boolean).length
console.log(`  方案树：${treesOk}/${ALL_TREES.length} 语义一致`)

const total = ALL_TREES.length + 3
console.log(failures ? `\n[FAIL] ${failures}/${total} 项语义不一致 —— 换数据源改变了学生看到的数据\n` : `\n[ok] ${total}/${total} 项语义一致（index/courses/course_index + 全部 ${ALL_TREES.length} 份方案树）：换数据源未改变任何学生可见数据\n`)
process.exit(failures ? 1 : 0)

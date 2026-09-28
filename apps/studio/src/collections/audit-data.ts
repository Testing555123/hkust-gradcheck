import type { CollectionConfig } from 'payload'

import SourceChunks from './source-chunks'
import { programBeforeValidate } from '../gates'

/**
 * 访问控制：实测 Payload 默认对匿名读返回 403「You are not allowed to perform this action」，
 * 而学生端是免登录的（用户裁决 ④：不做登录/个资/云端存档）。
 * 这里只放开 read —— 这份数据在现网本就是公开发布的（frontend/public/data 随静态站上公网），
 * 放开读不扩大任何外发面。写路径仍走默认的「仅已登录」，且 Programs 的写入受 §5 闸门约束。
 */
const PUBLIC_READ = { read: () => true } as const

/**
 * 五个数据集合，对应设计 v2 §4.1。
 *
 * 关键取舍（都是实测逼出来的，不是风格偏好）：
 * - source / derived 用 json 字段而非 relationship 建模：Payload 的 join 不支持
 *   arrays/blocks 内字段过滤，且组合里的 unresolved 课号（实测 1 例：
 *   2026-27_MINOR-ENVS → LIFS1030）一旦建关系就会被要求「课号必须存在于课程库」，
 *   那等于替学生猜课 —— 领域文档 §0-3 明令禁止。
 * - courses.creditsRaw 保留官方原文串（如 "3 Credit(s)"、"4-6"）：§3 口径是
 *   「取第一个数字、范围取下限」，预先转成 number 就把口径焊死在列类型里了。
 * - areas[] 不在 courses 上：实测它挂在「组→课」引用上，courses.json 课程级没有。
 */

const Programs: CollectionConfig = {
  slug: 'programs',
  access: PUBLIC_READ,
  // 选 Payload 而非 PocketBase 的唯一理由就是这项：版本 + 回滚 + 改动者审计。
  // 不开 versions 等于没测到选型依据，故本轮显式开启并在 gate-selftest 里实证。
  versions: { drafts: false },
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['year', 'code', 'category', 'revision', 'dataVersion'],
  },
  fields: [
    { name: 'year', type: 'text', required: true },
    { name: 'code', type: 'text', required: true },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: ['major', 'minor', 'extended', 'school'],
    },
    { name: 'title', type: 'text' },
    { name: 'totalRequiredCredits', type: 'number' },
    {
      name: 'source',
      type: 'json',
      required: true,
      admin: {
        description:
          '人工可编辑的权威源（等于 pipeline/output 的一份文档，含 required_credits_raw / source_pages / branch*）',
      },
    },
    {
      name: 'derived',
      type: 'json',
      admin: {
        readOnly: true,
        description: '机器重算的烘焙形态（combos / pool / order_index / source_ref）。勿手改。',
      },
    },
    { name: 'rulesVersion', type: 'text' },
    { name: 'revision', type: 'number', defaultValue: 1 },
    { name: 'dataVersion', type: 'text' },
    { name: 'lastPipelineHash', type: 'text' },
    { name: 'provenance', type: 'json' },
  ],
  hooks: { beforeValidate: [programBeforeValidate] },
  // 刻意不在此声明 indexes：领域文档 §6.3「不建索引：索引由 API 端建立，避免定义分散两处漂移」。
  // 试用轮的幂等性由 seed 的 find-then-upsert 保证；正式索引随 ADR-1 部署形态一并定。
}

const Courses: CollectionConfig = {
  slug: 'courses',
  access: PUBLIC_READ,
  admin: { useAsTitle: 'code', defaultColumns: ['code', 'title', 'creditsRaw', 'level'] },
  fields: [
    { name: 'code', type: 'text', required: true, unique: true },
    { name: 'title', type: 'text' },
    { name: 'creditsRaw', type: 'text', admin: { description: '官方原文串，口径解析在领域层' } },
    { name: 'credits', type: 'number' },
    { name: 'level', type: 'number' },
    { name: 'prerequisites', type: 'text' },
    { name: 'offeredSemesters', type: 'text' },
  ],
}

/** 反查索引物化：等价现 course_index.json。实测必须容纳 1344 个课号，
 *  其中 558 个不在课程库里 —— 所以 courseCode 是 text 而非 relationship。 */
const CourseRefs: CollectionConfig = {
  slug: 'course-refs',
  access: PUBLIC_READ,
  admin: { useAsTitle: 'courseCode', defaultColumns: ['courseCode', 'total'] },
  fields: [
    { name: 'courseCode', type: 'text', required: true },
    { name: 'refs', type: 'json' },
    { name: 'total', type: 'number', admin: { description: '真实引用数，refs 可能被 50 上限截断' } },
  ],
}

const CommonCoreMaps: CollectionConfig = {
  slug: 'common-core-maps',
  access: PUBLIC_READ,
  admin: { useAsTitle: 'admissionYear' },
  fields: [
    { name: 'admissionYear', type: 'text', required: true, unique: true },
    { name: 'map', type: 'json' },
  ],
}

const ValidationIssues: CollectionConfig = {
  slug: 'validation-issues',
  access: PUBLIC_READ,
  admin: { useAsTitle: 'code', defaultColumns: ['year', 'code', 'type', 'resolved'] },
  fields: [
    { name: 'year', type: 'text' },
    { name: 'code', type: 'text' },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        'credits_mismatch',
        'missing_in_courses_db',
        'combo_unresolved',
        'pipeline_conflict',
        'invariant_failed',
      ],
    },
    { name: 'resolved', type: 'checkbox', defaultValue: false },
    { name: 'detail', type: 'json' },
  ],
}

const Metas: CollectionConfig = {
  slug: 'metas',
  access: PUBLIC_READ,
  admin: { useAsTitle: 'key' },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true },
    { name: 'generatedAt', type: 'text' },
    { name: 'counts', type: 'json' },
  ],
}

export const dataCollections: CollectionConfig[] = [
  Programs,
  Courses,
  CourseRefs,
  CommonCoreMaps,
  ValidationIssues,
  Metas,
  SourceChunks,
]

import type { CollectionConfig } from 'payload'

/**
 * 切片层：毕业要求 PDF 的原文切片，供规则层回指与人工复核对照。
 *
 * 为什么单独建集合而不是塞进 programs.source：
 * - 一份专业几十到上百个切片，塞进 source 会让「人工可编辑的权威源」变得不可编辑；
 * - 复核时只需要「某条结论出自哪一页哪一段」，不需要把整份原文拉出来。
 *
 * chunkId 是稳定哈希（programKey + page + ordinal + text），因此 upsert 幂等：
 * 同一份 PDF 重复入库不会产生重复行，也不会刷版本号。
 */
const SourceChunks: CollectionConfig = {
  slug: 'source-chunks',
  access: { read: () => true },
  admin: {
    useAsTitle: 'chunkId',
    defaultColumns: ['programKey', 'page', 'ordinal', 'chunkId'],
  },
  fields: [
    { name: 'programKey', type: 'text', required: true, index: true },
    { name: 'chunkId', type: 'text', required: true, unique: true },
    { name: 'page', type: 'number', required: true },
    { name: 'ordinal', type: 'number', required: true },
    { name: 'charStart', type: 'number' },
    { name: 'charEnd', type: 'number' },
    { name: 'sourcePdf', type: 'text' },
    {
      name: 'text',
      type: 'textarea',
      admin: { description: '切片原文，用于人工复核时与抽取结论左右对照' },
    },
  ],
}

export default SourceChunks

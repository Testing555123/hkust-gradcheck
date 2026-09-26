import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 领域层已平移到 ../packages/domain（唯一的规则定义处）；此处只做解析重定向，
// 消费方的 `@/lib/audit` 等写法一字不改。顺序敏感：具体在前，'@/' 兜底在后。
const DOMAIN_MODULES =
  'attached|audit|branch|combos|common-core|course-filter|group-filter|pools|profile|program-groups|transcript'
const DOMAIN = path.resolve(__dirname, '../packages/domain/src')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/types$/, replacement: path.join(DOMAIN, 'types') },
      {
        find: new RegExp(`^@/lib/(${DOMAIN_MODULES})$`),
        replacement: path.join(DOMAIN, 'lib') + '/$1',
      },
      { find: /^@\//, replacement: path.resolve(__dirname, './src') + '/' },
    ],
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', '../packages/domain/src/**/*.test.ts'],
  },
})

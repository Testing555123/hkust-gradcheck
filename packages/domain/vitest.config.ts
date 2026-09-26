import { defineConfig } from 'vitest/config'

// 领域层是纯函数包，不需要 DOM：environment 用 node，跑得比 jsdom 快得多。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

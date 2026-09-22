import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 桩：localStorage 等浏览器 API（仓储测试要跑真实 IndexedDB 行为）
    setupFiles: ['tests/setup.ts'],
  },
})

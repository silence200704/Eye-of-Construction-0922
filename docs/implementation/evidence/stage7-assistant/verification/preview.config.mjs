import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../../../../../', import.meta.url)),
  base: './',
  preview: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:18002', changeOrigin: true } },
  },
})

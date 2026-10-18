import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiProxy = {
  '/api': { target: 'http://127.0.0.1:18000', changeOrigin: true },
}

export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
    proxy: apiProxy,
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: apiProxy },
  build: {
    outDir: 'dist',
    // 本地演示经常边开页面边构建：保留带 hash 的旧资源，供未刷新标签的懒加载使用。
    emptyOutDir: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // echarts 只被驾驶舱三张图用到：单独成包，避免应用主包被图表库顶到 1.5 MB
        manualChunks: { echarts: ['echarts', 'vue-echarts'], 'ui-runtime': ['vue', 'pinia', 'vue-router'] },
      },
    },
  },
})

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const title = '<title>筑瞳 · 校园建筑健康监测与预警系统</title>'

export async function ensurePreview({ url, start, timeoutMs = 3000 }) {
  let response
  let html
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    html = await response.text()
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') {
      await start()
      return { reused: false }
    }
    throw new Error(`无法确认 ${url} 的占用服务，请检查后重试。`, { cause: error })
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html') ||
      !html.includes(title) || !html.includes('<div id="app">')) {
    throw new Error(`${url} 被其他服务占用，请保留该服务并检查端口配置。`)
  }
  return { reused: true }
}

async function main() {
  const url = 'http://127.0.0.1:4173/'
  const result = await ensurePreview({
    url,
    start: async () => {
      const { preview } = await import('vite')
      const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true } })
      server.printUrls()
    },
  })
  if (result.reused) console.log(`筑瞳预览已运行，直接复用：${url}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}

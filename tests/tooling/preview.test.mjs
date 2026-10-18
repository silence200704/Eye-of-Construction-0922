import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'

const page = '<title>筑瞳 · 校园建筑健康监测与预警系统</title><div id="app"></div>'

async function fixture(t, handler) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return { server, url: `http://127.0.0.1:${server.address().port}/` }
}

test('复用已经运行的筑瞳，不再启动第二个预览进程', async t => {
  const { ensurePreview } = await import('../../scripts/preview.mjs')
  const { url } = await fixture(t, (_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(page)
  })
  const result = await ensurePreview({ url, start: () => assert.fail('不应重复启动') })
  assert.equal(result.reused, true)
})

test('端口空闲时启动预览', async t => {
  const { ensurePreview } = await import('../../scripts/preview.mjs')
  const { server, url } = await fixture(t, (_, res) => res.end())
  await new Promise(resolve => server.close(resolve))
  let starts = 0
  const result = await ensurePreview({ url, start: async () => { starts++ } })
  assert.equal(result.reused, false)
  assert.equal(starts, 1)
})

test('其他项目占用端口时明确报错，保留其服务', async t => {
  const { ensurePreview } = await import('../../scripts/preview.mjs')
  const { url } = await fixture(t, (_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>查寝系统</title>')
  })
  await assert.rejects(
    ensurePreview({ url, start: () => assert.fail('不能抢占其他项目端口') }),
    /被其他服务占用/,
  )
  assert.match(await (await fetch(url)).text(), /查寝系统/)
})

test('占用服务无响应时停止启动，不静默更换端口', async t => {
  const { ensurePreview } = await import('../../scripts/preview.mjs')
  const { url } = await fixture(t, () => {})
  await assert.rejects(
    ensurePreview({ url, timeoutMs: 50, start: () => assert.fail('不能绕过占用') }),
    /无法确认/,
  )
})

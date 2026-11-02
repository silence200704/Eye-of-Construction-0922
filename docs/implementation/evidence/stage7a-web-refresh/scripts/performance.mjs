import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from './browser/node_modules/playwright/index.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const outbound = new Set()
page.on('request', (request) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) outbound.add(request.url())
})
await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
await page.locator('.shell').waitFor()
const samples = []
for (let index = 0; index < 8; index++) {
  await page.evaluate(() => {
    window.__clickResult = null
    let start = 0
    const button = document.querySelector('.sidebar-toggle')
    button.addEventListener('click', () => { start = performance.now() }, { once: true, capture: true })
    const observer = new MutationObserver(() => {
      if (!start) return
      observer.disconnect()
      requestAnimationFrame(() => { window.__clickResult = performance.now() - start })
    })
    observer.observe(document.querySelector('.shell'), { attributes: true, attributeFilter: ['class'] })
  })
  await page.locator('.sidebar-toggle').click()
  await page.waitForFunction(() => window.__clickResult !== null)
  samples.push(await page.evaluate(() => window.__clickResult))
}
const captureFrames = page.evaluate(() => new Promise((resolve) => {
  const samples = []
  let previous = 0
  function frame(at) {
    if (previous) samples.push(at - previous)
    previous = at
    if (samples.length === 90) resolve(samples)
    else requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}))
for (let i = 0; i < 50; i++) await page.mouse.move(350 + i * 15, 520 + Math.sin(i) * 20)
const frames = await captureFrames
await page.goto(`${base}/#/trend`, { waitUntil: 'networkidle' })
await page.locator('.page-stage').waitFor()
await page.evaluate(() => {
  document.querySelector('.page-stage').dataset.identityProbe = 'preserved'
  document.querySelector('.content').scrollTop = 80
  location.hash = '#/trend?uiProbe=1'
})
await page.waitForURL('**/#/trend?uiProbe=1')
assert.equal(await page.locator('.page-stage').getAttribute('data-identity-probe'), 'preserved')
const queryPreservedScroll = await page.locator('.content').evaluate((el) => el.scrollTop)
await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '现场任务', exact: true }).click()
await page.waitForURL('**/#/inspection')
await page.waitForFunction(() => document.querySelector('.content').scrollTop === 0)
const sorted = [...frames].sort((a, b) => a - b)
const result = {
  method: 'Headless Chrome on this computer; default 1440x1000, no CPU/network throttling',
  clickToNextAnimationFrameMs: samples,
  medianFrameMs: sorted[Math.floor(sorted.length / 2)],
  p95FrameMs: sorted[Math.floor(sorted.length * .95)],
  framesOver50ms: frames.filter((value) => value > 50).length,
  frameCount: frames.length, outboundRequests: [...outbound],
  queryKeptPageInstance: true, queryPreservedScroll, pathChangeResetScroll: true,
  caveat: 'Local smoke measurement, not a universal FPS or INP guarantee; first-load/chart performance differs.',
}
await writeFile(new URL('./performance.json', import.meta.url), JSON.stringify(result, null, 2))
await browser.close()
console.log(JSON.stringify(result, null, 2))

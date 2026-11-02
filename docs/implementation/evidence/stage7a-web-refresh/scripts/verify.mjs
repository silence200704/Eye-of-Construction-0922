import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/node_modules/playwright/index.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const output = new URL('./verification/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], failures = [], pages = [], interactions = [], writes = [], outbound = new Set()
page.on('pageerror', (error) => errors.push(String(error)))
page.on('request', (request) => {
  const url = new URL(request.url())
  if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) outbound.add(request.url())
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
    writes.push({ method: request.method(), path: new URL(request.url()).pathname })
  }
})

async function visit(path) {
  await page.goto(`${base}/#${path}`, { waitUntil: 'networkidle' })
  await page.locator('.page-stage').waitFor({ timeout: 30000 })
}

async function shot(name) {
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)), animations: 'disabled' })
}

async function check(name, action) {
  try { await action(); interactions.push({ name, passed: true }) }
  catch (error) { failures.push({ name, message: String(error) }); interactions.push({ name, passed: false }) }
}

function layout() {
  const content = document.querySelector('.content')
  return { width: innerWidth, docWidth: document.documentElement.scrollWidth,
    contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth,
    overflows: [...document.querySelectorAll('.card,.welcome,.kpi,.filters')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.right > innerWidth + 1
    }).map((el) => ({ className: el.className, right: el.getBoundingClientRect().right })) }
}

await visit('/')
await shot('overview-wide')
await check('Sidebar collapse/expand', async () => {
  const trigger = page.getByRole('button', { name: '收起或展开侧边导航' })
  await trigger.click()
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.locator('.shell').evaluate((el) => el.classList.contains('shell--compact')), true)
  await trigger.click()
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
})
await check('Skip link focuses content without corrupting hash route', async () => {
  const original = page.url()
  await page.locator('.skip-link').focus()
  await page.keyboard.press('Enter')
  assert.equal(page.url(), original)
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content')
})
await check('Ctrl K search, input focus, Enter navigates', async () => {
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: '想去哪里看看？' }).waitFor()
  const input = page.getByRole('textbox', { name: '搜索页面名称' })
  assert.equal(await input.evaluate((el) => el === document.activeElement), true)
  await input.fill('问题')
  await shot('search-dialog')
  await input.press('Enter')
  await page.waitForURL('**/#/issues')
  assert.equal(await page.getByRole('dialog').count(), 0)
})
await check('Escape closes search and restores focus', async () => {
  const trigger = page.getByRole('button', { name: '搜索页面与功能（Ctrl K）' })
  await trigger.click()
  await page.getByRole('dialog', { name: '想去哪里看看？' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true)
})
await visit('/')
await check('Card rim follows pointer', async () => {
  const card = page.locator('.action-card').first()
  await card.hover()
  await page.waitForFunction(() => document.querySelector('.action-card').classList.contains('edge-surface--active'))
  assert.match(await card.evaluate((el) => el.style.getPropertyValue('--edge-x')), /px/)
  await page.mouse.move(500, 30)
})
await check('Record dialog validation, no successful writes', async () => {
  await page.getByRole('button', { name: '录入一条记录' }).click()
  await page.getByRole('dialog', { name: '录入监测数据' }).waitFor()
  await page.keyboard.press('Control+k')
  assert.equal(await page.getByRole('dialog').count(), 1)
  await shot('record-dialog')
  const save = page.getByRole('dialog').getByRole('button', { name: /保存|录入/ }).last()
  await save.click()
  assert.ok((await page.getByRole('dialog').innerText()).includes('请先选择测点'))
  await page.keyboard.press('Escape')
})
await check('Identity picker retains no-login workflow', async () => {
  await page.getByRole('button', { name: /切换身份/ }).click()
  await page.getByRole('dialog', { name: '切换演示身份' }).waitFor()
  assert.equal(await page.locator('input[type=password]').count(), 0)
  await shot('identity-dialog')
  await page.keyboard.press('Escape')
})
await check('Assistant opens and closes without sending a new question', async () => {
  await page.getByRole('button', { name: '问小瞳', exact: true }).click()
  await page.getByRole('button', { name: '关闭问筑瞳', exact: true }).waitFor()
  await shot('assistant-panel')
  await page.getByRole('button', { name: '关闭问筑瞳', exact: true }).click()
})

for (const width of [375, 768, 1280, 1920]) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
  for (const path of ['/', '/dashboard', '/monitor', '/alarms', '/inspection', '/issues', '/maintenance', '/knowledge', '/settings', '/reports', '/campus', '/archive', '/trend', '/media', '/standards']) {
    await visit(path)
    const result = await page.evaluate(layout)
    pages.push({ path, ...result })
    if (result.docWidth > width || result.contentScrollWidth > result.contentWidth + 1 || result.overflows.length) {
      failures.push({ name: `Layout ${width} ${path}`, ...result })
    }
    if (path === '/' || (width === 375 && ['/monitor', '/media'].includes(path)) || (width === 1280 && ['/dashboard', '/alarms', '/inspection', '/issues'].includes(path))) {
      await shot(`${width}-${path.replaceAll('/', '') || 'overview'}`)
    }
  }
}
await page.setViewportSize({ width: 1440, height: 1000 })
await visit('/dashboard')
await check('Sensor title keyboard focus and independent trend action', async () => {
  const sensor = page.locator('.sensor').first()
  const focus = sensor.locator('button.title')
  await focus.focus()
  await focus.press('Enter')
  assert.equal(await focus.getAttribute('aria-pressed'), 'true')
  await sensor.getByRole('button', { name: '看趋势', exact: true }).click()
  await page.waitForURL('**/#/trend?point=*')
})
await visit('/dashboard')
await check('Insight card expansion uses real classified targets', async () => {
  const button = page.locator('.counts button:not([disabled])').first()
  if (await button.count() === 0) throw new Error('No classified target available')
  await button.click()
  assert.equal(await button.getAttribute('aria-expanded'), 'true')
  const id = await button.getAttribute('aria-controls')
  await page.locator(`[id="${id}"]`).waitFor()
  await shot('insight-expanded')
  await button.click()
  assert.equal(await button.getAttribute('aria-expanded'), 'false')
})
await page.emulateMedia({ reducedMotion: 'reduce' })
await visit('/')
await check('Reduced motion disables decorative hover work', async () => {
  await page.locator('.action-card').first().hover()
  assert.equal(await page.locator('.action-card').first().evaluate((el) => el.classList.contains('edge-surface--active')), false)
  assert.equal(await page.locator('.page-stage').evaluate((el) => getComputedStyle(el).animationName), 'none')
})
const validBusinessWrites = writes.filter((row) => /\/(records|issues|work-orders|media-sessions)(\/|$)/.test(row.path))
assert.equal(validBusinessWrites.length, 0)
const result = { base, errors, failures, interactions, pages, writes, validBusinessWrites, outboundRequests: [...outbound],
  note: 'Navigation/dialogs/invalid validation only. Auth sessions and automatic notification receipts may be created by normal page startup; no valid records/issues/orders/media writes submitted.' }
await writeFile(new URL('results.json', output), JSON.stringify(result, null, 2))
await browser.close()
console.log(JSON.stringify({ interactions: interactions.length, pages: pages.length, errors, failures }, null, 2))
if (errors.length || failures.length) process.exitCode = 1

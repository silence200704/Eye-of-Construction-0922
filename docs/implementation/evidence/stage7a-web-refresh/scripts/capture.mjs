import { chromium } from './browser/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const label = process.argv[3] ?? 'before'
const output = new URL(`./${label}/`, import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
await page.locator('.shell').waitFor({ timeout: 30000 })
await page.screenshot({ path: fileURLToPath(new URL('overview.png', output)) })
await writeFile(new URL('page.json', output), JSON.stringify({
  url: page.url(), errors,
  headings: await page.locator('h1,h2').allTextContents(),
  width: await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })),
}, null, 2))
await browser.close()
console.log(`Captured ${label} overview`)

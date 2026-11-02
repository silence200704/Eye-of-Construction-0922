import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { chromium } from './browser/node_modules/playwright/index.mjs'
const require = createRequire(import.meta.url)
const { default: AxeBuilder } = require('./browser/node_modules/@axe-core/playwright')
const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const results = []
for (const path of ['/', '/monitor', '/alarms', '/inspection', '/issues', '/knowledge', '/settings', '/dashboard', '/maintenance', '/reports', '/campus', '/archive', '/trend', '/media', '/standards']) {
  await page.goto(`${base}/#${path}`, { waitUntil: 'networkidle' })
  await page.locator('.page-stage').waitFor()
  await page.waitForTimeout(300)
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  results.push({ path, violations: report.violations.map((item) => ({
    id: item.id, impact: item.impact, help: item.help,
    nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
  })) })
}
await writeFile(new URL('./axe-results.json', import.meta.url), JSON.stringify(results, null, 2))
await browser.close()
console.log(JSON.stringify(results.map((row) => ({ path: row.path,
  violations: row.violations.map((item) => ({ id: item.id, impact: item.impact, count: item.nodes.length })),
})), null, 2))

/** Rasterize original SVGs for handoff. Requires local QA Playwright and Chrome. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { chromium } = await import(pathToFileURL(resolve(root, 'backend/.runtime-ui-refresh/browser/node_modules/playwright/index.mjs')))
const folder = resolve(root, 'public/design-studio')
const file = resolve(folder, 'assets/manifest.json')
const manifest = JSON.parse(await readFile(file, 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
for (const asset of manifest.assets) {
  const target = `exports/${asset.path.replace(/\.svg$/, '.png')}`
  await mkdir(dirname(resolve(folder, target)), { recursive: true })
  await page.setViewportSize({ width: asset.width, height: asset.height })
  await page.goto(pathToFileURL(resolve(folder, 'assets', asset.path)).href, { waitUntil: 'load' })
  const bytes = await page.screenshot({ path: resolve(folder, target), omitBackground: true })
  asset.png = { path: target, width: asset.width, height: asset.height,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}
await browser.close()
await writeFile(file, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Exported ${manifest.assets.length} PNGs, ${manifest.assets.reduce((sum, asset) => sum + asset.png.bytes, 0)} bytes`)

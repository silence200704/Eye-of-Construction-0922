import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const ts = require(resolve(root, 'node_modules/typescript'))
const findings = [], files = []

async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name)
    if (entry.isDirectory() && entry.name !== '__pycache__') await scan(path)
    if (!entry.isFile() || !/\.(mjs|js)$/.test(entry.name)) continue
    const raw = await readFile(path, 'utf8')
    const source = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const stats = { file: path.slice(root.length + 1), lines: raw.trimEnd().split(/\r?\n/).length,
      maxFunctionLines: 0, maxParameters: 0 }
    function walk(node) {
      if (ts.isFunctionLike(node) && node.body) {
        const length = source.getLineAndCharacterOfPosition(node.end).line - source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        stats.maxFunctionLines = Math.max(stats.maxFunctionLines, length)
        stats.maxParameters = Math.max(stats.maxParameters, node.parameters.length)
        if (length > 80 || node.parameters.length > 5) findings.push({ path, length, params: node.parameters.length })
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
    if (stats.lines > 450) findings.push(stats)
    files.push(stats)
  }
}

await scan(resolve(root, 'scripts/design'))
await scan(resolve(root, 'public/design-studio/scripts'))
await writeFile(resolve(root, 'docs/implementation/evidence/stage7a-design-studio/js-structure.json'), JSON.stringify({ files, findings }, null, 2))
assert.equal(findings.length, 0, JSON.stringify(findings))
console.log(`JS structure: ${files.length} files, no functions over 80 lines or 5 parameters`)

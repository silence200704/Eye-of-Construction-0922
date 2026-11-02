import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const ts = require(resolve(root, 'node_modules/typescript'))
const lines = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
const paths = [...new Set([...lines(['diff', '--name-only', '--', 'src', 'tests']),
  ...lines(['ls-files', '--others', '--exclude-standard', '--', 'src', 'tests'])])]
const files = [], problems = []
for (const name of paths) {
  const raw = await readFile(resolve(root, name), 'utf8')
  const count = raw.trimEnd().split(/\r?\n/).length
  if (count > 450) problems.push({ file: name, lines: count })
  let maxFunction = 0, maxParameters = 0
  if (/\.(vue|ts|mjs|js)$/.test(name)) {
    const code = name.endsWith('.vue') ? raw.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '' : raw
    const tree = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function walk(node) {
      if (ts.isFunctionLike(node) && node.body) {
        const length = tree.getLineAndCharacterOfPosition(node.end).line - tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
        maxFunction = Math.max(maxFunction, length)
        maxParameters = Math.max(maxParameters, node.parameters.length)
        if (length > 80 || node.parameters.length > 5) problems.push({ file: name, functionLines: length, params: node.parameters.length })
      }
      ts.forEachChild(node, walk)
    }
    walk(tree)
  }
  files.push({ file: name, lines: count, maxFunction, maxParameters,
    sha256: createHash('sha256').update(raw).digest('hex') })
}
await writeFile(new URL('./architecture.json', import.meta.url), JSON.stringify({ files, problems }, null, 2))
console.log(JSON.stringify({ files: files.length, problems }, null, 2))
if (problems.length) process.exitCode = 1

import { createRequire } from 'node:module'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, relative, extname, join } from 'node:path'

const require = createRequire(import.meta.url)
const sdk = process.env.OPENHARMONY_SDK || 'D:/DevEco/OpenHarmonySdk/20'
const ts = require(`${sdk}/ets/build-tools/ets-loader/node_modules/typescript`)
const sdkConfig = ts.readConfigFile(`${sdk}/ets/build-tools/ets-loader/tsconfig.json`, ts.sys.readFile)
if (sdkConfig.error) throw new Error('Cannot load the SDK ArkUI parser configuration')
const root = process.cwd()
const ignored = new Set(['.git', 'build', '.hvigor', 'oh_modules', 'node_modules', '__pycache__'])
const violations = []
const files = []
let maxFunction = { lines: 0 }, maxFile = { lines: 0 }, functions = 0

function visitDirectory(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
  const directFiles = entries.filter(entry => entry.isFile() && entry.name !== 'local.properties')
  if (directFiles.length > 8) violations.push({ directory: relative(root, directory), directFiles: directFiles.length })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !ignored.has(entry.name)) visitDirectory(path)
    if (entry.isFile() && ['.ets', '.ts', '.mjs'].includes(extname(path))) files.push(path)
  }
}

function inspect(path) {
  const source = readFileSync(path, 'utf8')
  const name = relative(root, path).replaceAll('\\', '/')
  const lines = source.trimEnd().split('\n').length
  if (lines > maxFile.lines) maxFile = { path: name, lines }
  if (lines > 450) violations.push({ path: name, fileLines: lines })
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('.ets') ? ts.ScriptKind.ETS : ts.ScriptKind.TS, sdkConfig.config.compilerOptions)
  if (tree.parseDiagnostics.length) {
    violations.push({ path: name, parseErrors: tree.parseDiagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, ' ')) })
  }
  function walk(node) {
    if (ts.isFunctionLike(node) && node.body) {
      const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
      const end = tree.getLineAndCharacterOfPosition(node.end).line + 1
      const size = end - start + 1
      functions++
      if (size > maxFunction.lines) maxFunction = { path: name, line: start, lines: size }
      if (size > 80 || node.parameters.length > 5) {
        violations.push({ path: name, line: start, functionLines: size, parameters: node.parameters.length })
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
}

for (const scope of ['mobile/openharmony', 'tests/mobile', 'scripts/mobile']) visitDirectory(resolve(scope))
files.forEach(inspect)
const result = { parser: `OpenHarmony SDK TypeScript ${ts.version}, ScriptKind.ETS`,
  scope: ['mobile/openharmony', 'tests/mobile', 'scripts/mobile'], files: files.length, functions,
  maxFile, maxFunction, violations }
const directory = resolve(process.env.ZHUTONG_NATIVE_EVIDENCE || 'backend/.runtime-native-online/verification', 'builds')
mkdirSync(directory, { recursive: true })
writeFileSync(join(directory, 'structure-native.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
if (violations.length) process.exitCode = 1

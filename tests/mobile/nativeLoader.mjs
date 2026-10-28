import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const Module = require('node:module')
const original = Module._load
const ts = require('typescript')
export const nativeModules = new Map([['@ohos.url', { URL }]])

Module._load = function (request, parent, main) {
  if (nativeModules.has(request)) return nativeModules.get(request)
  return original.call(this, request, parent, main)
}

require.extensions['.ets'] = function (module, filename) {
  const source = readFileSync(filename, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: filename.replace(/\.ets$/, '.ts'),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  module._compile(result.outputText, filename)
}

export function native(path) {
  return require(resolve('mobile/openharmony/entry/src/main/ets', path))
}

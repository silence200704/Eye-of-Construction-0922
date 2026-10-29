import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native, nativeModules } from '../nativeLoader.mjs'

let exists = false, failCreate = false, failWrite = false, partialWrite = false
const files = new Map(), closed = [], deleted = []
nativeModules.set('@ohos.file.fs', {
  OpenMode: { READ_WRITE: 1, CREATE: 2, TRUNC: 4 },
  accessSync: () => exists,
  mkdirSync: () => {
    if (exists) throw new Error('File exists')
    if (failCreate) throw new Error('Permission denied /private/cache')
    exists = true
  },
  openSync: path => { files.set(path, null); return { fd: path } },
  writeSync: (fd, bytes) => {
    if (failWrite) throw new Error('No space left on device /private/cache')
    files.set(fd, bytes)
    return partialWrite ? bytes.byteLength - 1 : bytes.byteLength
  },
  closeSync: file => closed.push(file.fd),
  unlinkSync: path => { files.delete(path); deleted.push(path) },
})
nativeModules.set('@ohos.file.fileuri', { getUriFromPath: path => `file://${path}` })
const { SandboxPreviewFiles } = native('core/media/PreviewFiles.ets')
const { ApiError } = native('core/network/ApiError.ets')

function reset() {
  exists = false; failCreate = false; failWrite = false; partialWrite = false
  files.clear(); closed.length = 0; deleted.length = 0
}

test('consecutive saved photos reuse an existing sandbox directory and keep distinct bytes', () => {
  reset()
  const cache = new SandboxPreviewFiles('/private/cache')
  const a = new Uint8Array([1, 2]).buffer, b = new Uint8Array([3, 4, 5]).buffer
  const first = cache.write(a), second = cache.write(b)
  assert.notEqual(first, second)
  assert.deepEqual([...files.values()], [a, b])
  cache.remove(first); cache.remove(second); cache.remove(second)
  assert.equal(files.size, 0)
  assert.equal(closed.length, 2)
  // Directory survives after cleanup and after a new reader is created.
  const third = new SandboxPreviewFiles('/private/cache').write(a)
  assert.ok(third.startsWith('file:///private/cache/protected-photos/'))
})

test('native create and write errors become safe actionable photo errors; incomplete files are removed', () => {
  for (const failure of ['create', 'write', 'partial']) {
    reset()
    failCreate = failure === 'create'; failWrite = failure === 'write'; partialWrite = failure === 'partial'
    const cache = new SandboxPreviewFiles('/private/cache')
    assert.throws(() => cache.write(new Uint8Array([1, 2]).buffer), error => {
      assert.ok(error instanceof ApiError)
      assert.match(error.message, /照片.*重试/)
      assert.doesNotMatch(error.message, /File exists|Permission denied|No space|private/)
      return true
    })
    assert.equal(files.size, 0)
    assert.equal(closed.length, failure === 'create' ? 0 : 1)
  }
})

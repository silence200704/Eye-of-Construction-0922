import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'
import { queueFixture } from '../queue-fixture.mjs'
const { FieldQueue } = native('core/offline/field/FieldQueue.ets')
const { FieldExecutor } = native('core/offline/field/FieldExecutor.ets')

async function setup() {
  const f = await queueFixture(); const queue = new FieldQueue(f.vault)
  const requests = [], receipts = new Map(); let effects = 0, lost = false, error = null
  const access = { user: f.user, baseUrl: f.pack.baseUrl, workspace: f.workspace }
  access.client = { send: async (path, options) => {
    if (path === '/auth/me') return { data: access.user }
    requests.push({ path, ...options })
    if (error) throw error
    if (path.includes('/media?')) return { meta: { datasetEpoch: 1 }, data: { id: 'm', size: 3, sha256: 'a'.repeat(64) } }
    if (!receipts.has(options.idempotencyKey)) {
      effects++
      receipts.set(options.idempotencyKey, { issue: { id: 'new', rev: 1 }, task: { id: 't', rev: effects + 1 }, attempt: { passed: true } })
    }
    if (lost) { lost = false; throw new Error('lost after commit') }
    return { meta: { datasetEpoch: 1 }, data: receipts.get(options.idempotencyKey) }
  } }
  const executor = new FieldExecutor({ queue, access: () => access, files: { read: async () => new Uint8Array([1, 2, 3]).buffer }, onResult: () => {} })
  return { ...f, queue, executor, access, requests, effects: () => effects, lose: () => { lost = true }, fail: e => { error = e } }
}
const report = () => ({ kind: 'issue', targetId: '', path: '/issues', body: '{"description":"现场上报"}' })
test('field response loss and ten simultaneous sync attempts still commit once', async () => {
  const f = await setup(), row = await f.queue.enqueue(f.pack.scope, report(), [])
  f.lose(); await Promise.all(Array.from({ length: 10 }, () => f.executor.sync(f.pack.scope)))
  assert.equal(f.effects(), 1)
  assert.equal((await f.queue.list(f.pack.scope))[0].phase, 'unknown')
  await f.queue.retry(row.id, row.scope); await f.executor.sync(f.pack.scope)
  assert.equal(f.effects(), 1)
  assert.equal(f.requests[0].idempotencyKey, f.requests[1].idempotencyKey)
  assert.equal(f.requests[0].body, f.requests[1].body)
  assert.equal((await f.queue.list(f.pack.scope))[0].phase, 'done')
  await f.vault.close()
})
test('field photos are uploaded and checkpointed before the frozen business body', async () => {
  const f = await setup()
  const photo = { draftId: 'pic', path: '/private/pic', uri: 'file://pic', fileName: 'p.jpg', size: 3, sha256: 'a'.repeat(64), kind: 'scene', mediaId: '' }
  await f.queue.enqueue(f.pack.scope, report(), [], [photo]); await f.executor.sync(f.pack.scope)
  assert.match(f.requests[0].path, /\/media\?/)
  assert.equal(JSON.parse(f.requests[1].body).photos[0].mediaId, 'm')
  await f.vault.close()
})
test('conflicts stop dependents and do not overwrite newer task state', async () => {
  const f = await setup()
  const first = await f.queue.enqueue(f.pack.scope, { kind: 'task', targetId: 't', path: '/inspection/tasks/t/check-in', body: '{"expectedRev":1}' }, [])
  await f.queue.enqueue(f.pack.scope, { kind: 'task', targetId: 't', path: '/inspection/tasks/t/complete-point', body: '{"expectedRev":1}' }, [first.id])
  f.fail(Object.assign(new Error('new version'), { status: 409 }))
  await f.executor.sync(f.pack.scope)
  assert.equal(f.requests.length, 1)
  assert.deepEqual((await f.queue.list(f.pack.scope)).map(r => r.phase), ['conflict', 'queued'])
  await assert.rejects(f.queue.retry(first.id, first.scope))
  await f.queue.abandon(first.id, first.scope)
  assert.deepEqual((await f.queue.list(f.pack.scope)).map(r => r.phase), ['cancelled', 'cancelled'])
  await f.vault.close()
})
test('revoked identity never sends a mutation and corrupted files stop without business writes', async () => {
  const f = await setup()
  await f.queue.enqueue(f.pack.scope, report(), [])
  f.access.user = { ...f.user, buildingIds: [] }
  await f.executor.sync(f.pack.scope); assert.equal(f.requests.length, 0)
  assert.equal((await f.queue.list(f.pack.scope))[0].phase, 'blocked')
  await f.vault.close()
})

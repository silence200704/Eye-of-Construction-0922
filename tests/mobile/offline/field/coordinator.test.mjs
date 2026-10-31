import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'
import { queueFixture } from '../queue-fixture.mjs'
const { SyncCoordinator } = native('core/offline/field/SyncCoordinator.ets')
const { scopeKey } = native('core/offline/OfflineModels.ets')
const { FieldQueue } = native('core/offline/field/FieldQueue.ets')
test('returning to an earlier identity requires explicit resume even after restart', async () => {
  const f = await queueFixture(); let current = { baseUrl: f.pack.baseUrl, user: f.user, workspace: f.workspace }
  let effects = 0
  current.client = { send: async path => path === '/auth/me' ? { data: current.user } :
    { meta: { datasetEpoch: 1 }, data: { issue: { id: `i${++effects}`, rev: 1 } } } }
  const options = { vault: f.vault, access: () => current, files: { read: async () => new ArrayBuffer(0) }, onResult: () => {} }
  const first = new SyncCoordinator(options); await first.run()
  const original = current; current = { ...current, user: { ...f.user, id: 'repair', role: 'repair' } }; await first.run()
  current = original
  const queue = new FieldQueue(f.vault)
  await queue.enqueue(f.pack.scope, { path: '/issues', kind: 'issue', targetId: '', body: '{"submissionId":"resume"}' }, [])
  const second = new SyncCoordinator(options); await second.run()
  assert.equal(effects, 0)
  await second.approve(scopeKey(current)); await second.run(); assert.equal(effects, 1)
  await f.vault.close()
})

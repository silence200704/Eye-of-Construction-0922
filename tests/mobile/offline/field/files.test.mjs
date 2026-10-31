import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'
import { queueFixture } from '../queue-fixture.mjs'
test('media cleanup preserves all referenced bytes and recent interrupted writes', async () => {
  const { MediaLedger } = native('core/offline/media/MediaLedger.ets')
  const f = await queueFixture(), ledger = new MediaLedger(f.vault)
  const old = Date.now() - 8 * 86400000
  for (const id of ['referenced', 'orphan', 'recent']) await ledger.record({ id, scope: f.pack.scope, path: `/private/${id}.jpg`, phase: 'durable', at: id === 'recent' ? Date.now() : old })
  await f.vault.query(db => db.execute('INSERT INTO business_forms (scope,target,body) VALUES (?,?,?)', [f.pack.scope, 'form', JSON.stringify({ photos: [{ path: '/private/referenced.jpg' }] })]))
  const removed = []
  const count = await ledger.collect(f.pack.scope, { remove: (id, path) => { removed.push(path) } })
  assert.equal(count, 1); assert.deepEqual(removed, ['/private/orphan.jpg'])
  await f.vault.close()
})

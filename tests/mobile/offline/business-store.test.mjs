import test from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'
import { sql } from './queue-fixture.mjs'

test('business journal persists frozen commands and editing forms by identity scope', async () => {
  const { OfflineVault } = native('core/offline/OfflineVault.ets')
  const { BusinessStore } = native('core/business/BusinessStore.ets')
  const db = sql(); const vault = new OfflineVault(db)
  const store = new BusinessStore(vault)
  const journal = store.journal()
  const pending = { scope: 's', key: 'fixed', write: { path: '/issues/i/review', kind: 'issue', targetId: 'i', body: '{"expectedRev":1}' }, sent: true, phase: 'unknown' }
  await journal.save(pending)
  assert.equal((await journal.load('s')).key, 'fixed')
  assert.equal(await journal.load('other'), null)
  await assert.rejects(journal.save({ ...pending, write: { ...pending.write, body: '{"expectedRev":2}' } }), /冻结/)
  await store.saveForm('s', 'order:w', '{"measures":"已更换水泵"}')
  assert.match(await store.form('s', 'order:w'), /水泵/)
  assert.equal(await store.form('other', 'order:w'), '')
  await vault.close()
})

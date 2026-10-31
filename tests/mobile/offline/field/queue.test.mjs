import test from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'
import { queueFixture } from '../queue-fixture.mjs'
test('field dependency binds confirmed revision once and cannot overwrite a frozen request', async () => {
  const { FieldQueue } = native('core/offline/field/FieldQueue.ets')
  const f = await queueFixture(); const queue = new FieldQueue(f.vault)
  const first = await queue.enqueue(f.pack.scope, { path: '/inspection/tasks/t/check-in', kind: 'task', targetId: 't', body: '{"expectedRev":1,"pointId":"p"}' }, [])
  const next = await queue.enqueue(f.pack.scope, { path: '/inspection/tasks/t/complete-point', kind: 'task', targetId: 't', body: '{"expectedRev":1,"pointId":"p"}' }, [first.id])
  assert.equal(await queue.prepare(next.id, f.pack.scope), null)
  first.phase = 'done'; first.result = JSON.stringify({ task: { id: 't', rev: 2 }, attempt: { passed: true } })
  await queue.update(first)
  const prepared = await queue.prepare(next.id, f.pack.scope)
  assert.equal(JSON.parse(prepared.body).expectedRev, 2)
  prepared.phase = 'unknown'; await queue.update(prepared)
  const again = await queue.prepare(next.id, f.pack.scope)
  assert.equal(again.body, prepared.body); assert.equal(again.key, prepared.key)
  await assert.rejects(queue.update({ ...again, body: '{"expectedRev":99}' }), /冻结/)
  await f.vault.close()
})
test('a complete inspection workflow is enqueued atomically and idempotently', async () => {
  const { FieldQueue } = native('core/offline/field/FieldQueue.ets')
  const f = await queueFixture(); const queue = new FieldQueue(f.vault)
  const plan = { id: 'inspection-fixed', scope: f.pack.scope, photos: [], writes: [
    { path: '/inspection/tasks/t/check-in', kind: 'task', targetId: 't', body: '{"expectedRev":1}' },
    { path: '/inspection/tasks/t/complete-point', kind: 'task', targetId: 't', body: '{"expectedRev":1}' },
  ] }
  await queue.workflow(plan); await queue.workflow(plan)
  const rows = await queue.list(plan.scope)
  assert.equal(rows.length, 2); assert.deepEqual(rows[1].dependencies, [rows[0].id])
  await f.vault.close()
})

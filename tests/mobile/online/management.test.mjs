import test from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'

test('mobile management exposes the six review exits and identity based order actions', () => {
  const { reviewActions, orderActions, selectOrders } = native('core/business/BusinessPolicy.ets')
  assert.equal(reviewActions({ status: 'pending_review' }, { role: 'safety' }).length, 6)
  assert.deepEqual(reviewActions({ status: 'closed' }, { role: 'safety' }), [])
  assert.deepEqual(reviewActions({ status: 'pending_review' }, { role: 'repair' }), [])
  const order = { id: 'w', status: 'created', assigneeId: 'r', acceptedById: '' }
  assert.deepEqual(orderActions(order, { id: 's', role: 'safety' }), ['assigned'])
  assert.deepEqual(orderActions({ ...order, status: 'submitted' }, { role: 'safety' }), ['verified', 'returned'])
  assert.deepEqual(orderActions({ ...order, status: 'assigned' }, { id: 'r', role: 'repair' }), ['repairing'])
  assert.deepEqual(orderActions({ ...order, status: 'repairing', acceptedById: 'x' }, { id: 'r', role: 'repair' }), [])
  const rows = [{ ...order, title: '水泵', orderNo: 'W1' }, { ...order, id: 'q', assigneeId: 'q', title: '门', status: 'verified' }]
  assert.equal(selectOrders(rows, { userId: 'r', mine: true, status: 'all', search: '水', pointId: '' }).length, 1)
})

test('management writes preserve a fixed request across response loss and reject late identity', async () => {
  const { BusinessSession } = native('core/business/BusinessSession.ets')
  const calls = []
  let fail = true
  const access = { baseUrl: 'http://localhost', user: { id: 's', role: 'safety', buildingIds: null }, workspace: { epoch: 1 } }
  access.client = { send: async (path, options) => {
    if (path === '/auth/me') return { data: access.user }
    calls.push(options)
    if (fail) { fail = false; throw new Error('response lost') }
    return { meta: { datasetEpoch: 1 }, data: { order: { id: 'w', rev: 2, status: 'assigned' } } }
  } }
  let current = access
  let state
  const session = new BusinessSession({ access: () => current, onChange: v => { state = v }, onResult: () => {} })
  await session.submit({ path: '/work-orders/w/actions', targetId: 'w', kind: 'order', body: JSON.stringify({ expectedRev: 1, to: 'assigned', assigneeId: 'r' }) })
  assert.equal(state.phase, 'unknown')
  await session.retry()
  assert.equal(state.phase, 'done')
  assert.equal(calls[0].body, calls[1].body)
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey)
  current = null
  await session.retry()
  assert.equal(calls.length, 2)
})

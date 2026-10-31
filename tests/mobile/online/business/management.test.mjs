import test from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'

test('assigned owner can prepare a repair draft without acquiring completion permission', () => {
  const { startBusiness } = native('core/business/BusinessStart.ets')
  const { orderAllowed } = native('core/field/OrderPolicy.ets')
  const order = { id: 'w', status: 'assigned', rev: 2, assigneeId: 'r', measures: '', materials: '' }
  const state = { user: { id: 'r', role: 'repair' }, workspace: { orders: [order] } }
  assert.equal(JSON.parse(startBusiness(state, 'order', 'w', 'draft')).action, 'submitted')
  assert.equal(orderAllowed(order, state.user, 'submitted'), false)
  assert.throws(() => startBusiness({ ...state, user: { id: 'other', role: 'repair' } }, 'order', 'w', 'draft'))
})

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
test('native inspection commander restores a sent request after process recreation', async () => {
  const { TaskCommander } = native('core/field/TaskCommander.ets')
  const user = { id: 'i', role: 'inspector', buildingIds: null }
  const task = { id: 't', rev: 1, buildingId: 'b', planSnapshot: { executorRole: 'inspector', pointIds: ['p'] } }
  const access = { user, baseUrl: 'http://localhost', workspace: { epoch: 1, tasks: [task], points: [{ id: 'p', buildingId: 'b', status: 'active' }] } }
  let saved; const keys = []; let fail = true
  access.client = { send: async (path, opts) => {
    if (path === '/auth/me') return { data: user }
    keys.push(opts.idempotencyKey)
    if (fail) throw new Error('response lost')
    return { meta: { datasetEpoch: 1 }, data: { task: { ...task, rev: 2 } } }
  } }
  const journal = { load: async () => saved, save: async value => { saved = structuredClone(value) } }
  let state
  const options = { access: () => access, onState: s => { state = s }, onTask: t => t, invalidate: () => {}, journal }
  const first = new TaskCommander(options)
  await first.submit({ taskId: 't', pointId: 'p', action: 'check-in', body: '{"expectedRev":1,"pointId":"p"}' })
  assert.equal(saved?.phase, 'unknown')
  const next = new TaskCommander(options); await next.restore()
  assert.equal(state.phase, 'unknown'); fail = false; await next.retry()
  assert.equal(keys[0], keys[1]); assert.equal(saved.phase, 'done')
})
test('an incomplete action response never claims success, while rendering errors cannot undo confirmation', async () => {
  const { BusinessSession } = native('core/business/BusinessSession.ets')
  const user = { id: 's', role: 'safety', buildingIds: null }
  let state, valid = false
  const access = { baseUrl: 'http://localhost', user, workspace: { epoch: 1 } }
  access.client = { send: async path => path === '/auth/me' ? { data: user } :
    { meta: { datasetEpoch: 1 }, data: { order: { id: 'w', rev: valid ? 2 : 1, status: valid ? 'assigned' : 'created' } } } }
  const session = new BusinessSession({ access: () => access, onChange: v => { state = v }, onResult: () => { throw new Error('render failed') } })
  await session.submit({ path: '/work-orders/w/actions', kind: 'order', targetId: 'w', body: '{"expectedRev":1,"to":"assigned"}' })
  assert.equal(state.phase, 'unknown')
  valid = true; await session.retry(); assert.equal(state.phase, 'done')
})

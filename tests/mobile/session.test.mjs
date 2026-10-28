import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, deferred, identity, roles, ApiError } from './fixture.mjs'

test('default identity is server safety identity; saves only service root and identity id', async () => {
  const f = fixture()
  await f.controller.connect('http://127.0.0.1:18080/api/v1/')
  assert.equal(f.current().mode, 'ready')
  assert.equal(f.current().user.id, 'demo-safety')
  assert.deepEqual(f.saved, [{ baseUrl: 'http://127.0.0.1:18080', identityId: 'demo-safety' }])
  assert.ok(!JSON.stringify(f.saved).includes('token'))
})

test('all five role changes clear protected state synchronously and select server identities', async () => {
  const f = fixture()
  await f.controller.connect('http://localhost:8080')
  for (const role of roles) {
    const pending = f.controller.select(`demo-${role}`)
    assert.equal(f.current().user, null)
    assert.equal(f.current().identities.length, 5)
    assert.deepEqual(f.current().workspace.points, [])
    await pending
    assert.equal(f.current().user.role, role)
    assert.equal(f.current().workspace.points[0].id, `point-${role}`)
  }
})

test('a late identity response cannot replace a newer connection', async () => {
  const f = fixture(), held = deferred(), entered = deferred()
  let first = true
  f.server.intercept = call => {
    if (call.path === '/demo/identity' && first) {
      first = false; entered.resolve(); return held.promise
    }
  }
  const old = f.controller.connect('http://old.example:8080', 'demo-safety')
  await entered.promise
  await f.controller.connect('http://new.example:8080', 'demo-device')
  held.resolve({ ok: true, data: { accessToken: 'token-safety' } })
  await old
  assert.equal(f.current().user.id, 'demo-device')
  assert.equal(f.current().baseUrl, 'http://new.example:8080')
  assert.equal(f.saved.length, 1)
  assert.ok(f.clients[0].cancelled)
})

test('late protected rows are discarded even when native cancellation loses the race', async () => {
  const f = fixture(), held = deferred(), entered = deferred()
  f.server.intercept = call => {
    if (call.path.endsWith('/records') && call.role === 'safety') { entered.resolve(); return held.promise }
  }
  const old = f.controller.connect('http://localhost:8080', 'demo-safety')
  await entered.promise
  await f.controller.connect('http://localhost:8080', 'demo-device')
  held.resolve({ ok: true, data: [{ id: 'private-old-row' }], meta: { datasetEpoch: 1 } })
  await old
  assert.equal(f.current().user.id, 'demo-device')
  assert.ok(!f.frames.some(frame => frame.workspace.records.some(row => row.id === 'private-old-row')))
  assert.ok(!f.server.calls.some(call => call.role === 'safety' && call.path.includes('/events')))
})

test('dataset reset during a snapshot refuses mixed epochs and publishes no ready data', async () => {
  const f = fixture()
  f.server.intercept = call => call.path.endsWith('/records')
    ? { ok: true, data: [], meta: { datasetEpoch: 2 } } : undefined
  await f.controller.connect('http://localhost:8080')
  assert.equal(f.current().mode, 'error')
  assert.deepEqual(f.current().workspace.points, [])
  assert.ok(f.current().message.includes('数据已更新'))
  assert.equal(f.saved.length, 0)
})

test('principal mismatch and unsupported roles cannot become an authorized session', async () => {
  const f = fixture()
  f.server.principal = identity('repair')
  await f.controller.connect('http://localhost:8080', 'demo-safety')
  assert.equal(f.current().mode, 'error')
  assert.equal(f.current().user, null)
  assert.ok(!f.server.calls.some(call => call.path.endsWith('/archive')))
})

test('unknown identities are rejected before issuing a shortcut', async () => {
  const f = fixture()
  f.server.directory = [identity('administrator')]
  await f.controller.connect('http://localhost:8080')
  assert.equal(f.current().mode, 'error')
  assert.ok(!f.server.calls.some(call => call.path === '/demo/identity'))
})

test('refresh revalidates same-id reduced scope and never reuses old rows', async () => {
  const f = fixture()
  await f.controller.connect('http://localhost:8080')
  f.server.principal = { ...identity('safety'), buildingIds: [] }
  f.server.intercept = call => call.path.endsWith('/archive')
    ? { ok: true, data: { epoch: 1, buildings: [], floors: [], points: [], devices: [] }, meta: { datasetEpoch: 1 } }
    : undefined
  const refresh = f.controller.refresh()
  assert.equal(f.current().user, null)
  assert.deepEqual(f.current().workspace.points, [])
  await refresh
  assert.deepEqual(f.current().user.buildingIds, [])
  assert.deepEqual(f.current().workspace.points, [])
})

test('expired session refresh restores the same identity once; denied access does not change roles', async () => {
  const f = fixture()
  await f.controller.connect('http://localhost:8080', 'demo-device')
  let expired = true
  f.server.intercept = call => {
    if (call.path === '/auth/me' && expired) { expired = false; throw new ApiError('UNAUTHORIZED', '会话过期', 401) }
  }
  await f.controller.refresh()
  assert.equal(f.current().user.id, 'demo-device')
  const count = f.server.calls.filter(call => call.path === '/demo/identity').length
  f.server.intercept = call => { if (call.path === '/auth/me') throw new ApiError('FORBIDDEN', '没有权限', 403) }
  await f.controller.refresh()
  assert.equal(f.current().mode, 'error')
  assert.equal(f.current().user, null)
  assert.equal(f.server.calls.filter(call => call.path === '/demo/identity').length, count)
})

test('late preference restoration cannot resurrect a suspended screen', async () => {
  const held = deferred(), f = fixture({ storage: { load: () => held.promise, save: async () => {} } })
  const initialization = f.controller.initialize()
  f.controller.suspend()
  held.resolve({ baseUrl: 'http://localhost:8080', identityId: 'demo-safety' })
  await initialization
  assert.equal(f.current().mode, 'idle')
  assert.equal(f.current().user, null)
  assert.equal(f.server.calls.length, 0)
})

test('configuration failure is visible and cannot publish an online success', async () => {
  const f = fixture({ storage: { load: async () => ({ baseUrl: '', identityId: '' }),
    save: async () => { throw new Error('disk unavailable') } } })
  await f.controller.connect('http://localhost:8080')
  assert.equal(f.current().mode, 'error')
  assert.equal(f.current().user, null)
  assert.deepEqual(f.current().workspace.points, [])
  assert.ok(!f.frames.some(frame => frame.mode === 'ready'))
})

test('a scope change while snapshot rows are in flight invalidates the entire batch', async () => {
  const f = fixture()
  let checks = 0
  f.server.intercept = call => {
    if (call.path === '/auth/me' && ++checks === 2) {
      return { ok: true, data: { ...identity('safety'), buildingIds: [] } }
    }
  }
  await f.controller.connect('http://localhost:8080')
  assert.equal(f.current().mode, 'error')
  assert.equal(f.current().user, null)
  assert.deepEqual(f.current().workspace.points, [])
  assert.ok(f.current().message.includes('授权范围已变化'))
  assert.equal(f.saved.length, 0)
  assert.ok(!f.frames.some(frame => frame.mode === 'ready'))
})

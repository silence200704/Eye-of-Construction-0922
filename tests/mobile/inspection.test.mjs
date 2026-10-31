import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, deferred, ApiError, identity } from './fixture.mjs'

const task = () => ({ id: 'plan@2026-10-28T08:00:00+08:00', taskNo: 'T-NATIVE-01', rev: 1,
  buildingId: 'B1', status: 'pending', planSnapshot: { planName: '原生巡检', kind: 'patrol',
    executorRole: 'inspector', buildingId: 'B1', pointIds: ['point-inspector'],
    checklist: [{ key: 'wall', label: '墙面', required: true }] },
  results: [{ pointId: 'point-inspector', status: 'pending', attempts: [], checklist: [], issueIds: [] }] })

async function setup() {
  const f = fixture()
  f.task = task()
  f.server.intercept = call => call.path.endsWith('/inspection/tasks')
    ? { ok: true, data: [f.task], meta: { datasetEpoch: 1 } } : undefined
  await f.controller.connect('http://localhost:8080', 'demo-inspector')
  return f
}

for (const method of ['reloadInspection', 'reloadHandling']) {
  test(`${method} cannot replace a confirmed command with an older in-flight read`, async () => {
    const f = await setup(), entered = deferred(), held = deferred()
    f.server.intercept = call => {
      if (call.path.endsWith('/inspection/tasks')) { entered.resolve(); return held.promise }
      if (call.path.endsWith('/check-in')) return respond(f, call)
    }
    const reading = f.controller[method]()
    await entered.promise
    await f.controller.submitInspection(write())
    assert.equal(f.current().workspace.tasks[0].rev, 2)
    held.resolve({ ok: true, data: [f.task], meta: { datasetEpoch: 1 } })
    await reading
    assert.equal(f.current().workspace.tasks[0].rev, 2)
    assert.equal(f.current().workspace.tasks[0].results[0].status, 'arrived')
  })
}

const write = () => ({ taskId: task().id, pointId: 'point-inspector', action: 'check-in',
  body: JSON.stringify({ expectedRev: 1, pointId: 'point-inspector', method: 'nfc',
    labelRead: 'TAG-01', fallbackReason: '' }) })

function respond(f, call, passed = true) {
  const updated = { ...f.task, rev: 2, results: [{ ...f.task.results[0], status: passed ? 'arrived' : 'pending' }] }
  return { ok: true, data: { task: updated, attempt: { passed, message: passed ? '模拟读卡核对通过' : '标签编号不一致' } },
    meta: { datasetEpoch: 1, receiptId: 'receipt-native-01' } }
}

test('inspection POST carries epoch, stable operation key and an encoded task target', async () => {
  const f = await setup()
  f.server.intercept = call => call.options?.method === 'POST' ? respond(f, call) : undefined
  const result = await f.controller.submitInspection(write())
  const sent = f.server.calls.find(call => call.path.endsWith('/check-in'))
  assert.ok(sent.path.includes(encodeURIComponent(task().id)))
  assert.equal(sent.options.datasetEpoch, 1)
  assert.ok(sent.options.idempotencyKey.length > 12)
  assert.equal(JSON.parse(sent.options.body).expectedRev, 1)
  assert.equal(result.attempt.passed, true)
  assert.equal(f.current().workspace.tasks[0].results[0].status, 'arrived')
  assert.equal(f.current().workspace.tasks[0].status, 'pending')
})

test('rapid repeated clicks issue one POST while a request is in flight', async () => {
  const f = await setup(), held = deferred(), entered = deferred()
  f.server.intercept = call => {
    if (call.path.endsWith('/check-in')) { entered.resolve(); return held.promise }
  }
  const first = f.controller.submitInspection(write())
  await entered.promise
  assert.equal(await f.controller.submitInspection(write()), undefined)
  held.resolve(respond(f))
  await first
  assert.equal(f.server.calls.filter(call => call.path.endsWith('/check-in')).length, 1)
})

test('unknown network outcome retries the same immutable payload and operation key', async () => {
  const f = await setup(), sent = []
  f.server.intercept = call => {
    if (!call.path.endsWith('/check-in')) return
    sent.push(call)
    if (sent.length === 1) throw new ApiError('NETWORK_UNAVAILABLE', '响应未知')
    return respond(f)
  }
  assert.equal(await f.controller.submitInspection(write()), undefined)
  assert.equal(f.current().command.phase, 'unknown')
  const altered = write(); altered.body = altered.body.replace('TAG-01', 'OTHER')
  assert.equal(await f.controller.submitInspection(altered), undefined)
  assert.equal(sent.length, 1)
  await f.controller.retryInspection()
  assert.equal(sent[0].options.idempotencyKey, sent[1].options.idempotencyKey)
  assert.equal(sent[0].options.body, sent[1].options.body)
  assert.equal(f.current().command.phase, 'done')
})

test('a late write response cannot publish another identity task or success', async () => {
  const f = await setup(), held = deferred(), entered = deferred()
  f.server.intercept = call => {
    if (call.path.endsWith('/check-in')) { entered.resolve(); return held.promise }
  }
  const pending = f.controller.submitInspection(write())
  await entered.promise
  await f.controller.select('demo-device')
  held.resolve(respond(f))
  assert.equal(await pending, undefined)
  assert.equal(f.current().user.role, 'device')
  assert.deepEqual(f.current().workspace.tasks, [])
  assert.notEqual(f.current().command.phase, 'done')
})

test('wrong task executor is rejected locally and current server principal is checked before writes', async () => {
  const f = await setup()
  f.server.principal = { ...identity('inspector'), buildingIds: [] }
  await f.controller.submitInspection(write())
  assert.ok(!f.server.calls.some(call => call.path.endsWith('/check-in')))
  assert.equal(f.current().user, null)
  assert.deepEqual(f.current().workspace.tasks, [])
})

test('409 does not retry or overwrite a task; an explicit reload reads current revision', async () => {
  const f = await setup()
  f.server.intercept = call => {
    if (call.path.endsWith('/check-in')) throw new ApiError('REVISION_CONFLICT', '记录已更新', 409)
    if (call.path.endsWith('/inspection/tasks')) return { ok: true, data: [{ ...f.task, rev: 4 }], meta: { datasetEpoch: 1 } }
  }
  await f.controller.submitInspection(write())
  assert.equal(f.current().command.phase, 'conflict')
  assert.equal(f.current().workspace.tasks[0].rev, 1)
  await f.controller.reloadInspection()
  assert.equal(f.current().workspace.tasks[0].rev, 4)
  assert.equal(f.current().user.role, 'inspector')
  assert.equal(f.server.calls.filter(call => call.path.endsWith('/check-in')).length, 1)
})

test('HTTP 200 with a failed attempt is shown as a failed arrival and preserves server revision', async () => {
  const f = await setup()
  f.server.intercept = call => call.path.endsWith('/check-in') ? respond(f, call, false) : undefined
  const result = await f.controller.submitInspection(write())
  assert.equal(result.attempt.passed, false)
  assert.equal(f.current().workspace.tasks[0].rev, 2)
  assert.equal(f.current().workspace.tasks[0].results[0].status, 'pending')
  assert.ok(f.current().command.message.includes('标签编号不一致'))
})

test('mixed dataset epochs in a successful-looking write are never applied', async () => {
  const f = await setup()
  f.server.intercept = call => call.path.endsWith('/check-in')
    ? { ...respond(f, call), meta: { datasetEpoch: 2 } } : undefined
  assert.equal(await f.controller.submitInspection(write()), undefined)
  assert.notEqual(f.current().command.phase, 'done')
  assert.ok(!f.frames.some(frame => frame.workspace.tasks.some(t => t.rev === 2)))
})

test('task reload rechecks authorization after rows arrive and cannot publish a reduced-scope snapshot', async () => {
  const f = await setup()
  f.server.intercept = call => {
    if (call.path.endsWith('/inspection/tasks')) {
      f.server.principal = { ...identity('inspector'), buildingIds: [] }
      return { ok: true, data: [{ ...f.task, rev: 9 }], meta: { datasetEpoch: 1 } }
    }
  }
  await f.controller.reloadInspection()
  assert.equal(f.current().user, null)
  assert.deepEqual(f.current().workspace.tasks, [])
})

test('local role and task boundaries reject writes before contacting a mutation endpoint', async () => {
  const f = await setup()
  f.task.planSnapshot.executorRole = 'repair'
  await f.controller.submitInspection(write())
  assert.equal(f.current().command.phase, 'error')
  f.task.planSnapshot.executorRole = 'inspector'
  await f.controller.submitInspection({ ...write(), pointId: 'unrelated' })
  assert.equal(f.current().command.phase, 'error')
  f.current().workspace.points[0].status = 'archived'
  await f.controller.submitInspection(write())
  assert.equal(f.current().command.phase, 'error')
  assert.ok(!f.server.calls.some(call => call.path.endsWith('/check-in')))
})

test('unknown write survives a role round-trip and explicitly retries the old request only under its original identity', async () => {
  const f = await setup(), sent = []
  f.server.intercept = call => {
    if (call.path.endsWith('/inspection/tasks')) return { ok: true, data: [f.task], meta: { datasetEpoch: 1 } }
    if (call.path.endsWith('/check-in')) {
      sent.push(call)
      if (sent.length === 1) throw new ApiError('NETWORK_UNAVAILABLE', '响应未知')
      return respond(f)
    }
  }
  await f.controller.submitInspection(write())
  await f.controller.select('demo-device')
  assert.equal(await f.controller.retryInspection(), undefined)
  await f.controller.select('demo-inspector')
  assert.equal(f.current().command.phase, 'unknown')
  await f.controller.retryInspection()
  assert.equal(sent.length, 2)
  assert.equal(sent[0].options.idempotencyKey, sent[1].options.idempotencyKey)
  assert.ok(sent.every(call => call.role === 'inspector'))
})

test('server validation errors are definitive, while malformed successful responses keep a retryable immutable request', async () => {
  const f = await setup()
  f.server.intercept = call => {
    if (call.path.endsWith('/check-in')) throw new ApiError('VALIDATION_FAILED', '校验未通过', 422)
  }
  await f.controller.submitInspection(write())
  assert.equal(f.current().command.phase, 'error')
  f.server.intercept = call => call.path.endsWith('/check-in')
    ? { ok: true, data: {}, meta: { datasetEpoch: 1 } } : undefined
  await f.controller.submitInspection(write())
  assert.equal(f.current().command.phase, 'unknown')
  assert.equal(f.current().workspace.tasks[0].rev, 1)
})

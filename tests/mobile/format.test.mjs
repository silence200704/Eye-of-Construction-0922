import assert from 'node:assert/strict'
import { test } from 'node:test'
import { native, nativeModules } from './nativeLoader.mjs'

const { normalizeEndpoint } = native('core/network/Endpoint.ets')
const { numberText, reading, latestRecord, freshness, visibleEvents } = native('shared/format/display.ets')
const { ConnectionPreferences } = (() => {
  nativeModules.set('@ohos.data.preferences', { getPreferencesSync: context => context.store })
  return native('core/storage/ConnectionPreferences.ets')
})()

test('service root accepts explicit HTTP/HTTPS roots and rejects credentials, query, path and bad schemes', () => {
  assert.equal(normalizeEndpoint(' https://campus.example:443/api/v1/ '), 'https://campus.example')
  for (const value of ['localhost:8080', 'javascript:alert(1)', 'ftp://campus.example',
    'http://user:password@campus.example', 'https://campus.example?q=x', 'https://campus.example/a']) {
    assert.throws(() => normalizeEndpoint(value))
  }
})

test('missing, invalid and manual readings never turn into zero or normal', () => {
  assert.equal(numberText(undefined), '—')
  assert.equal(numberText(NaN), '—')
  assert.equal(numberText(0), '0')
  assert.equal(reading(undefined, 'crack'), '暂无记录')
  assert.equal(reading(undefined, 'manual_check'), '人工检查点')
  assert.equal(reading({ values: {}, unit: 'mm' }, 'crack'), '— mm')
})

test('latest record follows sample time rather than backfill arrival; missing and stale times are labeled', () => {
  const records = [
    { id: 'new', pointId: 'P1', sampleTime: '2026-10-26T02:00:00Z', enteredAt: '2026-10-26T02:01:00Z' },
    { id: 'backfill', pointId: 'P1', sampleTime: '2026-10-01T00:00:00Z', enteredAt: '2026-10-26T03:00:00Z' },
  ]
  assert.equal(latestRecord({ records }, 'P1').id, 'new')
  assert.equal(latestRecord({ records }, 'P2'), undefined)
  assert.equal(freshness(undefined), '未取得采样时间')
  assert.equal(freshness({ sampleTime: '2000-01-01T00:00:00Z' }), '历史采样，非实时数据')
  assert.equal(freshness({ sampleTime: 'invalid' }), '采样时间无效')
})

test('preference saves are serialized and store no access tokens or business snapshots', async () => {
  const state = {}, calls = [], pending = []
  const store = {
    getSync: (key, fallback) => state[key] ?? fallback,
    putSync: (key, value) => { state[key] = value; calls.push([key, value]) },
    flush: () => new Promise(resolve => pending.push(resolve)),
  }
  const storage = new ConnectionPreferences({ store })
  const first = storage.save({ baseUrl: 'http://old.example', identityId: 'demo-safety' })
  const second = storage.save({ baseUrl: 'http://new.example', identityId: 'demo-device' })
  await Promise.resolve()
  assert.equal(pending.length, 1)
  pending.shift()()
  await first
  await Promise.resolve()
  assert.equal(pending.length, 1)
  pending.shift()()
  await second
  assert.deepEqual(await storage.load(), { baseUrl: 'http://new.example', identityId: 'demo-device' })
  assert.deepEqual([...new Set(calls.map(([key]) => key))].sort(), ['baseUrl', 'identityId'])
})

test('sensor filter also scopes alarm history, retaining matching archived-point history', () => {
  const workspace = { points: [{ id: 'C', type: 'crack' }, { id: 'T', type: 'tilt', status: 'archived' }],
    events: [{ id: 'EC', pointId: 'C', status: 'handling' }, { id: 'ET', pointId: 'T', status: 'closed' }] }
  assert.deepEqual(visibleEvents(workspace, 'tilt', false), [])
  assert.deepEqual(visibleEvents(workspace, 'tilt', true).map(row => row.id), ['ET'])
  assert.deepEqual(visibleEvents(workspace, 'all', true).map(row => row.id), ['EC', 'ET'])
})

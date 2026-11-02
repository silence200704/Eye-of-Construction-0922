import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'
import { fixture, deferred } from '../fixture.mjs'

const {
  trendFields, filterTrendRecords, buildTrendPoints, dailyAveragePoints, trendSummary, splitTrendLine, trendThresholds, formatTrend,
} = native('core/monitoring/Trend.ets')

function record(id, sampleTime, values, extra = {}) {
  return {
    id, recordNo: id, pointId: 'p', sampleTime, enteredAt: sampleTime, values,
    unit: 'mm', source: 'csv', quality: 'valid', isBackfill: true, ruleVersion: 'V1.0', ...extra,
  }
}

test('metric fields match the five point types and manual checks stay non-numeric', () => {
  assert.deepEqual(trendFields('crack').map((field) => field.key), ['width'])
  assert.deepEqual(trendFields('tilt').map((field) => field.key), ['angleX', 'angleY'])
  assert.deepEqual(trendFields('vibration').map((field) => field.key), ['accelRms', 'accelPeak'])
  assert.deepEqual(trendFields('temp_humidity').map((field) => field.key), ['temperature', 'humidity'])
  assert.deepEqual(trendFields('manual_check'), [])
})

test('range filtering excludes old and future samples and sorts the curve by time', () => {
  const now = Date.parse('2026-10-31T00:00:00Z')
  const rows = [
    record('old', '2026-10-01T00:00:00Z', { width: 0.4 }),
    record('late', '2026-10-30T12:00:00Z', { width: 0.54 }),
    record('early', '2026-10-25T00:00:00Z', { width: 0.5 }),
    record('future', '2026-11-02T00:00:00Z', { width: 9 }),
  ]
  assert.deepEqual(filterTrendRecords(rows, 7, now).map((row) => row.id), ['early', 'late'])
  assert.deepEqual(filterTrendRecords(rows, 30, now).map((row) => row.id), ['old', 'early', 'late'])
})

test('daily averages group same-day samples by Shanghai date without hiding raw values', () => {
  const field = trendFields('crack')[0]
  const points = buildTrendPoints([
    record('a', '2026-10-29T01:00:00Z', { width: 0.50 }),
    record('b', '2026-10-30T02:00:00Z', { width: 0.52 }),
    record('c', '2026-10-30T08:00:00Z', { width: 0.54 }),
    record('d', '2026-10-31T01:00:00Z', { width: 0.56 }),
  ], field)
  const averaged = dailyAveragePoints(points)
  assert.equal(averaged.length, 3)
  assert.equal(Number(averaged[0].value.toFixed(4)), 0.5)
  assert.equal(Number(averaged[1].value.toFixed(4)), 0.53)
  assert.equal(Number(averaged[2].value.toFixed(4)), 0.56)
  assert.equal(points.length, 4)
})

test('summary reports latest range and change, and a long gap splits the line', () => {
  const field = trendFields('crack')[0]
  const points = buildTrendPoints([
    record('a', '2026-10-25T00:00:00Z', { width: 0.50 }),
    record('b', '2026-10-25T01:00:00Z', { width: 0.52 }),
    record('c', '2026-10-27T03:00:00Z', { width: 0.55 }),
  ], field)
  const summary = trendSummary(points)
  assert.equal(summary.count, 3)
  assert.equal(summary.latest, 0.55)
  assert.equal(summary.min, 0.5)
  assert.equal(summary.max, 0.55)
  assert.ok(Math.abs(summary.change - 0.05) < 1e-9)
  assert.equal(splitTrendLine(points).length, 2)
  assert.equal(formatTrend(0.5500000000000001, 2), '0.55')
})

test('thresholds are absolute for relative crack metrics and unchanged for vibration', () => {
  const snapshot = { ruleVersion: 'V1.0', thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 } }
  const crack = trendThresholds([record('a', '2026-10-25T00:00:00Z', { width: 0.52 },
    { baselineValues: { width: 0.5 }, ruleSnapshot: snapshot })], 'crack', 'width')
  assert.deepEqual(crack.thresholds, { yellow: 0.6, orange: 0.7, red: 0.8 })
  const vibration = trendThresholds([record('v', '2026-10-25T00:00:00Z', { accelRms: 0.02 },
    { baselineValues: null, ruleSnapshot: snapshot })], 'vibration', 'accelRms')
  assert.deepEqual(vibration.thresholds, { yellow: 0.1, orange: 0.2, red: 0.3 })
  const environment = trendThresholds([record('t', '2026-10-25T00:00:00Z', { temperature: 23 },
    { ruleSnapshot: { thresholds: null } })], 'temp_humidity', 'temperature')
  assert.equal(environment.thresholds, null)
})

test('trend reads are scoped to the selected point and authorized epoch', async () => {
  const f = fixture()
  await f.controller.connect('http://localhost:8080')
  const rows = [record('a', '2026-10-25T00:00:00Z', { width: 0.5 })]
  rows[0].pointId = 'point-safety'
  f.server.intercept = (call) => call.path.includes('/records?pointId=') ? { data: rows, meta: { datasetEpoch: 1 } } : undefined
  assert.deepEqual(await f.controller.readTrend('point-safety'), rows)
  const call = f.server.calls.find((row) => row.path.includes('/records?pointId='))
  assert.match(call.path, /pointId=point-safety/)
  assert.match(call.path, /limit=5000/)
})

test('trend response for another point or after an identity switch cannot reach the page', async () => {
  const f = fixture()
  await f.controller.connect('http://localhost:8080')
  f.server.intercept = (call) => call.path.includes('/records?pointId=') ?
    { data: [{ ...record('a', '2026-10-25T00:00:00Z', { width: 0.5 }), pointId: 'other' }], meta: { datasetEpoch: 1 } } : undefined
  await assert.rejects(f.controller.readTrend('point-safety'), (error) => error.code === 'INVALID_RESPONSE')

  const held = deferred()
  f.server.intercept = (call) => call.path.includes('/records?pointId=') ? held.promise : undefined
  const pending = f.controller.readTrend('point-safety')
  await new Promise((resolve) => setImmediate(resolve))
  await f.controller.select('demo-repair')
  held.resolve({ data: [record('a', '2026-10-25T00:00:00Z', { width: 0.5 })], meta: { datasetEpoch: 1 } })
  assert.equal(await pending, null)
})

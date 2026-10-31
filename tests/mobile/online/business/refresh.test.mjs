import test from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'
test('visible refresh is single flight, backs off and cancels background scheduling', async () => {
  const { LiveRefresh } = native('core/business/refresh/LiveRefresh.ets')
  const jobs = new Map(); let n = 0; const delays = []; let calls = 0
  const clock = { schedule: (work, delay) => { delays.push(delay); jobs.set(++n, work); return n }, cancel: id => jobs.delete(id) }
  const loop = new LiveRefresh({ read: async () => { calls++; if (calls < 3) throw new Error('offline') }, clock })
  await loop.start(); assert.equal(calls, 1); assert.equal(delays.at(-1), 10000)
  await jobs.get(n)(); assert.equal(delays.at(-1), 20000)
  await jobs.get(n)(); assert.equal(delays.at(-1), 5000)
  loop.stop(); assert.equal(jobs.has(n), false)
})

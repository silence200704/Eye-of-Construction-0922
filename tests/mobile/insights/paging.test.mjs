import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'

test('500 nonzero frequency objects are ranked and paged without losing any object or changing input', () => {
  const { countPage } = native('core/monitoring/InsightPaging.ets')
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}`, label: `测点${i}`, count: i % 7 + 1 }))
  const original = structuredClone(rows), ids = []
  for (let page = 0; page < 25; page++) {
    const view = countPage(rows, page)
    assert.equal(view.items.length, 20)
    assert.equal(view.pages, 25)
    assert.equal(view.page, page)
    assert.equal(view.total, 500)
    ids.push(...view.items.map(row => row.id))
  }
  assert.equal(new Set(ids).size, 500)
  assert.deepEqual(rows, original)
  const first = countPage(rows, 0).items
  assert.ok(first.every(row => row.count === 7))
  assert.equal(first[0].id, 'p006')
})

test('empty, zero-frequency and stale page positions produce an honest bounded view', () => {
  const { countPage } = native('core/monitoring/InsightPaging.ets')
  assert.deepEqual(countPage([{ id: 'zero', label: '空态', count: 0 }], 8).items, [])
  assert.equal(countPage([], -5).page, 0)
  assert.equal(countPage([], 0).pages, 1)
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: String(i), label: '测点', count: 1 }))
  assert.equal(countPage(rows, 90).page, 1)
  assert.equal(countPage(rows, 90).items.length, 1)
  assert.equal(countPage(rows, NaN).page, 0)
})

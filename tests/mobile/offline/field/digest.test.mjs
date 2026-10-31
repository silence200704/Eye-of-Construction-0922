import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { native } from '../../nativeLoader.mjs'
test('request digest matches SHA-256 for exact UTF-8 payload bytes', () => {
  const { requestDigest } = native('core/business/persistence/RequestDigest.ets')
  for (const value of ['', 'abc', '维修措施：更换水泵🔧', 'x'.repeat(1000)]) {
    assert.equal(requestDigest(value), createHash('sha256').update(value).digest('hex'))
  }
})

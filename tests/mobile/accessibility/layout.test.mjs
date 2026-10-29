import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'

test('system scale grows input height without shrinking text or capping a large user setting', () => {
  const { controlHeight, fontScale } = native('shared/layout/ReadingLayout.ets')
  assert.equal(controlHeight(54, 1), 54)
  assert.equal(controlHeight(54, 2), 84)
  assert.equal(controlHeight(54, 3.2), 120)
  assert.equal(controlHeight(48, 0.8), 48)
  for (const value of [0, -1, NaN, Infinity]) assert.equal(fontScale(value), 1)
  assert.equal(fontScale(3.2), 3.2)
})

test('narrow or enlarged workbenches stack cards while a wide window keeps two columns', () => {
  const { singleColumn } = native('shared/layout/ReadingLayout.ets')
  assert.equal(singleColumn(390, 1), false)
  assert.equal(singleColumn(390, 2), true)
  assert.equal(singleColumn(320, 1), true)
  assert.equal(singleColumn(840, 2), false)
})

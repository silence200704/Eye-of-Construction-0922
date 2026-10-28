import assert from 'node:assert/strict'
import { test } from 'node:test'
import { native, nativeModules } from './nativeLoader.mjs'

const values = new Map()
globalThis.AppStorage = { setOrCreate: (key, value) => values.set(key, value) }
nativeModules.set('@ohos.data.preferences', { getPreferencesSync: context => context.store })
const { AppearancePreferences } = native('core/storage/AppearancePreferences.ets')

test('saved quiet mode is restored before native components read their shared UI state', () => {
  const settings = new AppearancePreferences({ store: { getSync: () => false } })
  assert.ok(settings)
  assert.equal(values.get('zhutong.motion'), false)
})

test('appearance saves are ordered and only persist the motion preference', async () => {
  const calls = [], pending = [], stored = {}
  const store = {
    getSync: (_, fallback) => fallback,
    putSync: (key, value) => { calls.push(key); stored[key] = value },
    flush: () => new Promise(resolve => pending.push(resolve)),
  }
  const settings = new AppearancePreferences({ store })
  settings.setMotion(true)
  settings.setMotion(false)
  assert.equal(values.get('zhutong.motion'), false)
  await Promise.resolve()
  assert.equal(pending.length, 1)
  pending.shift()()
  for (let n = 0; n < 8 && pending.length === 0; n++) await Promise.resolve()
  assert.equal(pending.length, 1)
  pending.shift()()
  for (let n = 0; n < 4; n++) await Promise.resolve()
  assert.deepEqual(stored, { motion: false })
  assert.deepEqual(calls, ['motion', 'motion'])
})

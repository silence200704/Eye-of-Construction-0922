import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { native, nativeModules } from '../nativeLoader.mjs'

test('AppScope resolves the packaged follow-system font profile without capping system scale', () => {
  const scope = resolve('mobile/openharmony/AppScope')
  const app = JSON.parse(readFileSync(resolve(scope, 'app.json5'), 'utf8')).app
  assert.match(app.configuration ?? '', /^\$profile:[\w.]+$/)
  const name = app.configuration.slice('$profile:'.length)
  const profile = JSON.parse(readFileSync(resolve(scope, 'resources/base/profile', `${name}.json`), 'utf8'))
  assert.equal(profile.configuration.fontSizeScale, 'followSystem')
  assert.equal(profile.configuration.fontSizeMaxScale, undefined)
})

test('configuration updates log the newly delivered font scale rather than the stale context', () => {
  const logs = [], storage = new Map()
  globalThis.AppStorage = { setOrCreate: (key, value) => storage.set(key, value) }
  nativeModules.set('@ohos.app.ability.UIAbility', class {})
  nativeModules.set('@ohos.hilog', { info: (...args) => logs.push(args) })
  nativeModules.set('@ohos.accessibility', { isScreenReaderOpenSync: () => false })
  const EntryAbility = native('entryability/EntryAbility.ets').default
  const ability = new EntryAbility()
  ability.context = { config: { fontSizeScale: 1, direction: 0 } }
  ability.onConfigurationUpdate({ fontSizeScale: 2, direction: 1 })
  assert.deepEqual(logs[0].slice(3), ['2', 'false', '1'])
  assert.equal(storage.get('zhutong.fontScale'), 2)
})

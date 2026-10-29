import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('AppScope resolves the packaged follow-system font profile without capping system scale', () => {
  const scope = resolve('mobile/openharmony/AppScope')
  const app = JSON.parse(readFileSync(resolve(scope, 'app.json5'), 'utf8')).app
  assert.match(app.configuration ?? '', /^\$profile:[\w.]+$/)
  const name = app.configuration.slice('$profile:'.length)
  const profile = JSON.parse(readFileSync(resolve(scope, 'resources/base/profile', `${name}.json`), 'utf8'))
  assert.equal(profile.configuration.fontSizeScale, 'followSystem')
  assert.equal(profile.configuration.fontSizeMaxScale, undefined)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { native, nativeModules } from './nativeLoader.mjs'
import { deferred } from './fixture.mjs'

let nextResponse, destroyThrows = false, destroyed = 0, observed = null
nativeModules.set('@ohos.net.http', {
  RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 'STRING' },
  createHttp: () => ({
    request: async (address, options) => { observed = { address, options }; return nextResponse },
    destroy: () => { destroyed++; if (destroyThrows) throw Error('cleanup failed') },
  }),
})
const { BackendClient } = native('core/network/BackendClient.ets')

test('native client sends bearer and exact API path without enabling cache', async () => {
  nextResponse = { responseCode: 200, result: JSON.stringify({ ok: true, data: [] }) }
  const client = new BackendClient({ baseUrl: 'https://campus.example', token: 'fixture-token' })
  await client.send('/datasets/demo-main/records')
  assert.equal(observed.address, 'https://campus.example/api/v1/datasets/demo-main/records')
  assert.equal(observed.options.header.Authorization, 'Bearer fixture-token')
  assert.equal(observed.options.usingCache, false)
  assert.equal(observed.options.connectTimeout, 6000)
})

test('server status and business errors stay visible; HTML or malformed envelopes never succeed', async () => {
  const client = new BackendClient({ baseUrl: 'http://localhost:8080', token: '' })
  nextResponse = { responseCode: 403, result: JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: '没有权限' } }) }
  await assert.rejects(client.send('/auth/me'), cause => cause.code === 'FORBIDDEN' && cause.status === 403)
  for (const result of ['<html/>', 'null', '{}', '{"ok":true}']) {
    nextResponse = { responseCode: 200, result }
    await assert.rejects(client.send('/auth/me'), cause => cause.code === 'INVALID_RESPONSE')
  }
})

test('cancelled native response is rejected even when transport destruction throws', async () => {
  const held = deferred()
  nextResponse = held.promise
  destroyThrows = true
  const client = new BackendClient({ baseUrl: 'http://localhost:8080', token: '' })
  const pending = client.send('/auth/me')
  client.cancel()
  held.resolve({ responseCode: 200, result: JSON.stringify({ ok: true, data: { id: 'late' } }) })
  await assert.rejects(pending, cause => cause.code === 'CANCELLED')
  await assert.rejects(client.send('/auth/me'), cause => cause.code === 'CANCELLED')
  assert.ok(destroyed > 0)
  destroyThrows = false
})

test('request paths cannot escape the configured origin', async () => {
  const client = new BackendClient({ baseUrl: 'http://localhost:8080', token: '' })
  for (const path of ['//external.example', 'https://external.example']) {
    await assert.rejects(client.send(path), cause => cause.code === 'INVALID_PATH')
  }
})

test('native command headers carry idempotency and dataset epoch without replacing bearer', async () => {
  nextResponse = { responseCode: 200, result: JSON.stringify({ ok: true, data: {} }) }
  const client = new BackendClient({ baseUrl: 'http://localhost:8080', token: 'fixture-token' })
  await client.send('/datasets/demo-main/inspection/tasks/task/check-in', {
    method: 'POST', body: '{}', idempotencyKey: 'native-stable-key', datasetEpoch: 7,
  })
  assert.equal(observed.options.header['Idempotency-Key'], 'native-stable-key')
  assert.equal(observed.options.header['X-Dataset-Epoch'], '7')
  assert.equal(observed.options.header.Authorization, 'Bearer fixture-token')
})

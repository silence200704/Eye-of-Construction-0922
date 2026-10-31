import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'
test('assistant suggestions append to a saved draft without submitting or editing an unknown command', async () => {
  const { applyBusinessSuggestion } = native('core/business/persistence/SuggestionBridge.ets')
  let body = JSON.stringify({ draft: { kind: 'order', action: 'submitted', measures: '原维修措施' }, photos: [{ draftId: 'keep' }] })
  let blocked = false
  const store = { pending: async () => blocked ? {} : null, form: async () => body, saveForm: async (_s, _k, value) => { body = value } }
  await applyBusinessSuggestion(store, 'scope', 'target', 'AI建议仅供核对')
  assert.match(JSON.parse(body).draft.measures, /原维修措施\nAI建议/)
  assert.equal(JSON.parse(body).photos[0].draftId, 'keep')
  blocked = true; await assert.rejects(applyBusinessSuggestion(store, 'scope', 'target', '不能覆盖未知请求'))
})

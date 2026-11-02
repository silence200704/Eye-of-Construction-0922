import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'

const { AssistantSession } = native('core/assistant/AssistantSession.ets')

function fixture() {
  const calls = []
  const views = []
  const answer = {
    intent: 'issue_status', status: 'ok',
    conclusion: '工单 WO-1 当前待接单，接单后填写维修措施再提交验收。',
    facts: [{ label: '工单状态', value: '待派工', unit: '' }],
    links: [{ kind: 'workorder_detail', objectId: 'wo-1' }],
    followups: ['复查安排是什么'],
    dataNotes: ['演示数据'],
    objects: { pointId: 'p-1', eventId: null, issueId: 'is-1', workOrderId: 'wo-1', buildingId: 'b-1' },
  }
  const access = {
    baseUrl: 'http://localhost:8080', user: { id: 'u-1', role: 'repair' },
    workspace: { epoch: 7 },
    client: {
      send: async (path, options) => {
        calls.push({ path, options })
        return { data: { sessionId: 's-1', turnId: 't-1', answer }, meta: { datasetEpoch: 7 } }
      },
    },
  }
  const session = new AssistantSession({
    access: () => access,
    onChange: (view) => views.push(view),
    invalidate: (message) => { throw new Error(message) },
  })
  return { session, access, calls, views, answer }
}

test('mobile AI asks the server with explicit work-order context and keeps the answer', async () => {
  const f = fixture()
  f.session.setContext({ workOrderId: 'wo-1' }, 'WO-1 待派工')
  await f.session.ask('这个工单下一步怎么处理？')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].path, '/datasets/demo-main/assistant/query')
  assert.equal(f.calls[0].options.method, 'POST')
  assert.equal(f.calls[0].options.datasetEpoch, 7)
  const body = JSON.parse(f.calls[0].options.body)
  assert.equal(body.question, '这个工单下一步怎么处理？')
  assert.equal(body.context.chosen, true)
  assert.equal(body.context.workOrderId, 'wo-1')
  const view = f.views.at(-1)
  assert.equal(view.phase, 'ready')
  assert.equal(view.turns.length, 1)
  assert.match(view.turns[0].answer.conclusion, /WO-1/)
  assert.equal(view.contextLabel, 'WO-1 待派工')
})

test('mobile AI reports an unavailable server without inventing an answer', async () => {
  const f = fixture()
  f.access.client.send = async () => { throw new Error('network down') }
  await f.session.ask('现在有什么风险？')
  const view = f.views.at(-1)
  assert.equal(view.phase, 'error')
  assert.equal(view.turns.length, 0)
  assert.ok(view.message.length > 0)
})

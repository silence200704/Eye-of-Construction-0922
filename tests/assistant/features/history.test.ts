import { expect, it } from 'vitest'
import { setupHarness, NOW } from '../harness'
import { makeEvent, makeIssue, makePoint, makeRecord, makeWorkOrder } from '../../fixtures'
import { buildSnapshot } from '@/assistant/selectors'
import { completionGaps, findCases } from '@/assistant/cases/query'
import { queryContext } from '@/assistant/query/context'
import { buildEventReport } from '@/core/metrics/eventReport'

const round = { subject: '固定复核', owner: '安全员', dueDate: '2026-09-20', at: NOW, by: '安全员',
  outcome: 'recovered' as const, outcomeAt: NOW, outcomeBy: '安全员', outcomeNote: '已恢复' }
it('完整案例必须同时有复查、全工单验收和事件关闭，当前问题排除后计数', async () => {
  const history = makeIssue({ id: 'history', eventId: 'history-event', status: 'closed', workOrderIds: ['history-order'], rechecks: [round] })
  await setupHarness({ events: [makeEvent({ id: 'history-event', status: 'closed', closedAt: NOW })],
    issues: [makeIssue(),history], workOrders: [makeWorkOrder({ id: 'history-order', issueId: history.id, eventId: history.eventId })] })
  const snapshot = buildSnapshot()
  expect(completionGaps(history,snapshot)).toEqual([])
  expect(findCases(snapshot,{ pointId: 'pnt_1', issueId: 'iss_1' })).toMatchObject({ total: 1, rows: [{ issueId: 'history', complete: true }] })
  expect(completionGaps({ ...history,rechecks: [], workOrderIds: ['missing'] },snapshot).join('；')).toContain('缺少复查结论')
  snapshot.details!.orders[0]!.status = 'submitted'
  snapshot.events[0]!.status = 'handling'
  expect(completionGaps(history,snapshot).join('；')).toContain('尚未验收')
  expect(completionGaps(history,snapshot)).toContain('事件尚未关闭')
})
it('回放与报告包含原升级依据和问题复查，不推测不存在的节点', async () => {
  const event = makeEvent({ status: 'closed', closedAt: NOW, upgrades: [{ at: NOW, by: '安全员', byRole: '学校安全管理人员', from: 'orange', to: 'red', recordNo: 'R-RED', triggerValue: 0.32, ruleVersion: 'V1' }] })
  const issue = makeIssue({ eventId: event.id, status: 'closed', rechecks: [round] })
  const h = await setupHarness({ events: [event],issues: [issue] })
  const result = await h.ask('回放当前事件的升级过程',{ eventId: event.id })
  expect(result.intent).toBe('event_replay')
  expect(result.evidence.map(e => e.ref)).toContain('R-RED')
  const followup = await h.ask('当时依据哪条记录？',result.context)
  expect(followup.conclusion).toContain('R-RED')
  const report = buildEventReport({ event,issues: [issue],orders: [],notifications: [],point: null,device: null })
  const text = JSON.stringify(report.sections)
  expect(text).toContain('确认恢复')
  expect(text).toContain('已关闭')
  expect(text).not.toContain('pending_review')
})
it('双点歧义保留原对象，跨单位分卡、空范围明确说明', async () => {
  const h = await setupHarness({ points: [makePoint(),makePoint({ id: 'p2', code: 'B01-F2-TH01', metric: 'temp_humidity', type: 'temp_humidity' })] })
  const context = { pointIds: ['pnt_1','p2'] }
  expect(queryContext({ question: '它怎么样',previous: context,page: {},snapshot: buildSnapshot() })).toMatchObject({ status: 'need_choice' })
  const result = await h.ask('比较B01-F2-CRACK01和B01-F2-TH01最近24小时的读数')
  expect(result.status).toBe('not_found')
  const preview = result.previews[0]
  expect(preview.kind === 'point_compare' && preview.cards.length).toBe(3)
})
it('试算追问沿用候选，取消清草稿，保存命令不误触发试算', async () => {
  const h = await setupHarness({ records: [makeRecord({ sampleTime: NOW,values: { width: 0.54 } })] })
  const first = await h.ask('试算黄色阈值改为0.01毫米，最近7天哪些记录会改变等级？',{ pointId: 'pnt_1' })
  const next = await h.ask('只看等级变化的记录',first.context)
  expect(next.status).toBe('answered')
  expect(next.context?.simulation?.yellow).toBe(0.01)
  expect((await h.ask('取消试算',next.context)).context?.simulation).toBeUndefined()
  const save = await h.ask('修改规则，黄色阈值改为0.15毫米',next.context)
  expect(save.previews).toEqual([])
})
it('办理进度读取实际链，完整报告用真实事件链接', async () => {
  const h = await setupHarness({ events: [makeEvent()], issues: [makeIssue({ eventId: 'evt_1' })] })
  const result = await h.ask('现在办理到哪一步了？',{ eventId: 'evt_1' })
  expect(result.conclusion).toContain('待审核')
  expect(result.links.some(link => link.path === '/reports/event/evt_1')).toBe(true)
})

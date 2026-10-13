/**
 * 问筑瞳 · 「为什么触发红色预警」。
 *
 * 守的是"证据引用"这条线：触发值、基准值、阈值、规则与版本、证据记录号必须来自
 * 事件里已落库的判定快照；来源为"设备上报（演示补录）"的记录要写明它不是设备心跳。
 */
import { describe, expect, it } from 'vitest'
import type { AlarmEvent, EventEvidence } from '@/types/events'
import { makeEvent } from '../../fixtures'
import { claims, notes, record, setupHarness } from '../harness'

const EVIDENCE: EventEvidence = {
  recordId: 'rec_red',
  recordNo: 'R20260920-005',
  sampleTime: '2026-09-20T11:30:00.000Z',
  level: 'red',
  triggerValue: 0.32,
  baselineValue: 0.5,
  ruleCode: 'RULE-CRACK-001',
  ruleVersion: 'V1.0',
  thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
  basis: '相对基准的变化量',
  reason: '相对基准变化 0.32 mm，超过红色阈值 0.30 mm',
  addedAt: '2026-09-20T11:35:00.000Z',
  addedBy: '物业值班 · 张工',
  addedByRole: 'property',
}

function redEvent(overrides: Partial<AlarmEvent> = {}): AlarmEvent {
  return makeEvent({
    id: 'evt_red',
    eventNo: 'E20260920-001',
    level: 'red',
    peakLevel: 'red',
    status: 'pending',
    unit: 'mm',
    openedAt: '2026-09-20T11:35:00.000Z',
    lastTriggerAt: '2026-09-20T11:35:00.000Z',
    lastTriggerValue: 0.32,
    evidences: [EVIDENCE],
    upgrades: [
      { at: '2026-09-20T11:36:00.000Z', by: '系统', byRole: 'system', from: 'yellow', to: 'orange', recordNo: 'R20260920-005', triggerValue: 0.22, ruleVersion: 'V1.0' },
      { at: '2026-09-20T11:37:00.000Z', by: '系统', byRole: 'system', from: 'orange', to: 'red', recordNo: 'R20260920-005', triggerValue: 0.32, ruleVersion: 'V1.0' },
    ],
    ...overrides,
  })
}

function redRecord() {
  return record({
    id: 'rec_red',
    recordNo: 'R20260920-005',
    sampleTime: '2026-09-20T11:30:00.000Z',
    enteredAt: '2026-09-20T11:35:00.000Z',
    values: { width: 0.82 },
    baselineValues: { width: 0.5 },
  })
}

describe('为什么触发红色预警', () => {
  it('引用证据记录号、触发值与命中规则，并给出审批口径', async () => {
    const h = await setupHarness({ records: [redRecord()], events: [redEvent()] })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })

    expect(result.status).toBe('answered')
    expect(result.intent).toBe('event_reason')
    expect(result.conclusion).toContain('E20260920-001')
    expect(result.conclusion).toContain('R20260920-005')
    expect(result.conclusion).toContain('红色紧急核查')
    expect(result.conclusion).toContain('RULE-CRACK-001')
    expect(result.evidence.map((row) => row.ref)).toContain('R20260920-005')

    const facts = result.facts.map((row) => `${row.label}=${row.value}${row.unit}`).join('\n')
    expect(facts).toContain('触发值=0.32mm')
    expect(facts).toContain('判定基准=0.50mm')
    expect(facts).toContain('RULE-CRACK-001（V1.0）')
    expect(facts).toContain('黄 0.10 / 橙 0.20 / 红 0.30mm')
    expect(facts).toContain('升级过程=黄 → 橙 → 红')
    // 详情与报告的深链指向同一条事件
    expect(result.links.some((row) => row.kind === 'event_detail' && row.query.event === 'evt_red')).toBe(true)
    expect(result.links.some((row) => row.path === '/reports/event/evt_red')).toBe(true)
  })

  it('没有上下文时取当前唯一的未关闭红色事件', async () => {
    const h = await setupHarness({ records: [redRecord()], events: [redEvent()] })
    const result = await h.ask('为什么这条是红色')
    expect(result.status).toBe('answered')
    expect(result.conclusion).toContain('E20260920-001')
    expect(result.dataNotes.join('\n')).toContain('当前唯一的未关闭红色事件')
  })

  it('多条红色事件时不猜，返回候选', async () => {
    const h = await setupHarness({
      records: [redRecord()],
      events: [redEvent(), redEvent({ id: 'evt_red2', eventNo: 'E20260920-002' })],
    })
    const result = await h.ask('为什么这条是红色')
    expect(result.status).toBe('need_choice')
    expect(result.candidates.map((row) => row.label)).toEqual(['E20260920-001（红色紧急核查）', 'E20260920-002（红色紧急核查）'])
  })

  it('没有红色事件时照实说明，并指出当前最高等级', async () => {
    const h = await setupHarness({ records: [redRecord()], events: [redEvent({ id: 'evt_y', eventNo: 'E20260920-003', level: 'yellow', peakLevel: 'yellow', evidences: [] })] })
    const result = await h.ask('为什么这条是红色')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('没有未关闭的红色事件')
    expect(result.conclusion).toContain('E20260920-003')
  })

  it('问句里点名楼栋与指标时，解释该测点未关闭的事件', async () => {
    const h = await setupHarness({ records: [redRecord()], events: [redEvent()] })
    const result = await h.ask('B01-F2-CRACK01 为什么红了')
    expect(result.status).toBe('answered')
    expect(result.conclusion).toContain('E20260920-001')
    expect(result.dataNotes.join('\n')).toContain('该测点当前等级最高的一条未关闭事件')
  })

  it('来源为"设备上报（演示补录）"的记录不被读成设备心跳', async () => {
    const h = await setupHarness({
      records: [record({ ...redRecord(), source: 'device' })],
      events: [redEvent()],
    })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })
    expect(result.provenance?.sourceLabel).toBe('传感器数据（演示）')
    expect(notes(result)).toContain('不是已接入的设备心跳')
  })

  it('人工录入的记录不会被说成设备上送', async () => {
    const h = await setupHarness({ records: [redRecord()], events: [redEvent()] })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })
    expect(result.provenance?.sourceLabel).toBe('人工录入')
    expect(notes(result)).not.toContain('演示补录')
  })

  it('已关闭事件说明关闭依据，并提示这是当时的判定依据', async () => {
    const h = await setupHarness({
      records: [redRecord()],
      events: [
        redEvent({
          status: 'closed',
          closedAt: '2026-09-20T11:50:00.000Z',
          closedBy: '安全管理员',
          closeBasis: '复测回落至基准附近并经现场核查',
          acknowledgedAt: '2026-09-20T11:40:00.000Z',
          acknowledgedBy: '安全管理员',
        }),
      ],
    })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })
    expect(result.status).toBe('answered')
    expect(claims(result)).toContain('已关闭')
    expect(claims(result)).toContain('复测回落至基准附近并经现场核查')
    expect(notes(result)).toContain('本回答说明的是当时的判定依据')
  })

  it('证据被修订替代过、有升级历史时都写清楚', async () => {
    const h = await setupHarness({
      records: [redRecord()],
      events: [
        redEvent({
          supersededEvidences: [
            { evidence: { ...EVIDENCE, level: 'orange', recordId: 'rec_old', recordNo: 'R20260920-004' }, supersededAt: '2026-09-20T11:40:00.000Z', supersededBy: '安全管理员', reason: '原记录采样时间填错，已更正' },
          ],
        }),
      ],
    })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })
    expect(notes(result)).toContain('1 条证据已被修订替代')
    expect(notes(result)).toContain('经历过 2 次升级：黄 → 橙 → 红')
  })

  it('证据对应的原始记录不在本机时，仍按快照回答并说明无法复核', async () => {
    const h = await setupHarness({ records: [], events: [redEvent()] })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })
    expect(result.status).toBe('answered')
    expect(result.provenance).toBeNull()
    expect(result.timing).toBeNull()
    expect(result.conclusion).toContain('R20260920-005')
  })

  it('没有活跃证据时不给原因', async () => {
    const h = await setupHarness({ records: [redRecord()], events: [redEvent({ evidences: [] })] })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('没有活跃证据')
    expect(result.gaps.join('\n')).toContain('证据链为空')
  })

  it('上下文事件不存在时（数据集已替换）说明要重新选择，不返回旧对象', async () => {
    const h = await setupHarness({ records: [redRecord()], events: [] })
    const result = await h.ask('为什么这条是红色', { eventId: 'evt_red' })
    expect(result.status).toBe('not_found')
    expect(claims(result)).not.toContain('E20260920-001')
    expect(result.conclusion).toContain('已不在当前数据集')
    expect(result.conclusion).toContain('请重新选择')
  })
})

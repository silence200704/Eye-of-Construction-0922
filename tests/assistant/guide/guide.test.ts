import { describe, expect, it } from 'vitest'
import { buildGuidePlan } from '@/assistant/guide/plan'
import { buildSnapshot } from '@/assistant/selectors'
import { useAssistantStore } from '@/assistant/session'
import { executeConfirmedCommand } from '@/assistant/commands/execute'
import { markDatasetReset } from '@/stores/demo/registry'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useEventsStore } from '@/stores/events'
import { makeEvent } from '../../fixtures'
import { setupHarness } from '../harness'

describe('问筑瞳演示导览', () => {
  it('没有事件时只给确认入口，普通提问和计划不写库', async () => {
    const h = await setupHarness()
    const before = [await db.records.count(), await db.events.count(), await db.audits.count()]
    const result = await h.ask('带我演示处理流程')
    expect(result.intent).toBe('demo_guide')
    expect(result.guide).toEqual({ eventId: null, canPrepare: true })
    expect(result.conclusion).toContain('没有未关闭的红色事件')
    expect(buildGuidePlan(buildSnapshot(), '').phase).toBe('prepare')
    expect([await db.records.count(), await db.events.count(), await db.audits.count()]).toEqual(before)
  })

  it('唯一红色事件绑定真实编号；计划随事件状态重读', async () => {
    const event = makeEvent({ id: 'evt_red', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red', status: 'pending' })
    const h = await setupHarness({ events: [event] })
    const result = await h.ask('带我演示处理流程')
    expect(result.guide).toEqual({ eventId: event.id, canPrepare: false })
    expect(result.links.find((link) => link.kind === 'event_detail')?.query.event).toBe(event.id)
    // 待确认 = 第 1 步（与事件详情页的「现场处置流程 1/7 步」同一条梯子）
    expect(buildGuidePlan(buildSnapshot(), event.id)).toMatchObject({ phase: 'inspect', stage: 'event_pending', step: 1, eventNo: event.eventNo })
    // 确认后还没有问题 → 第 2 步「等待转问题」，下一责任角色是安全管理人员
    await db.events.update(event.id, { status: 'handling' })
    await h.events.reload()
    expect(buildGuidePlan(buildSnapshot(), event.id)).toMatchObject({
      phase: 'handling', stage: 'issue_missing', step: 2, nextRole: '学校安全管理人员',
    })
  })

  it('多条红色事件不猜；过期事件不回退到另一条', async () => {
    const first = makeEvent({ id: 'evt_a', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red' })
    const second = makeEvent({ id: 'evt_b', eventNo: 'E20260920-002', level: 'red', peakLevel: 'red' })
    const h = await setupHarness({ events: [first, second] })
    const ambiguous = await h.ask('带我演示处理流程')
    expect(ambiguous.guide).toEqual({ eventId: null, canPrepare: false })
    expect(ambiguous.conclusion).toContain('2 条')
    const missing = await h.ask('带我演示处理流程', { eventId: 'evt_deleted' })
    expect(missing.guide).toEqual({ eventId: null, canPrepare: false })
    expect(missing.conclusion).toContain('已不在当前数据集')
    expect(buildGuidePlan(buildSnapshot(), 'evt_deleted').phase).toBe('stale')
  })

  it('唯一历史红色事件用于回看，不建议再创建演示事件', async () => {
    const event = makeEvent({ id: 'evt_closed', eventNo: 'E20260920-003', level: 'red', peakLevel: 'red', status: 'closed' })
    const h = await setupHarness({ events: [event] })
    const result = await h.ask('带我演示处理流程')
    expect(result.guide).toEqual({ eventId: event.id, canPrepare: false })
    expect(result.conclusion).toContain('历史红色事件')
    expect(buildGuidePlan(buildSnapshot(), event.id)).toMatchObject({ phase: 'closed', eventNo: event.eventNo })
  })

  it('显式选择已关闭的黄色事件时不误称历史红色', async () => {
    const event = makeEvent({ id: 'evt_yellow', eventNo: 'E20260920-004', level: 'yellow', peakLevel: 'yellow', status: 'closed' })
    const h = await setupHarness({ events: [event] })
    const result = await h.ask('带我演示 E20260920-004 处理流程')
    expect(result.guide?.eventId).toBe(event.id)
    expect(result.conclusion).toContain('历史事件')
    expect(result.conclusion).not.toContain('历史红色事件')
  })

  it('确认场景后按库中同一事件推进；数据集替换清掉导览', async () => {
    localStorage.clear()
    await setupHarness()
    await useArchiveStore().loadSeed()
    await Promise.all([useRecordsStore().reload(), useEventsStore().reload()])
    const assistant = useAssistantStore()
    await assistant.ask('带我演示处理流程')
    expect(assistant.guideActive).toBe(true)
    const out = await executeConfirmedCommand('prepare_red_demo', true)
    expect(out?.ok).toBe(true)
    const id = out?.focus?.query.event ?? ''
    expect(assistant.beginGuide(id, true)).toBe(true)
    expect(assistant.guideEventId).toBe(id)
    expect(buildGuidePlan(buildSnapshot(), id).eventNo).toBe(out?.anchors[0])
    await assistant.refreshGuideAfterWrite()
    expect(assistant.turns.filter((row) => row.result?.intent === 'demo_guide')).toHaveLength(1)
    expect(assistant.last?.result?.guide?.eventId).toBe(id)
    expect(assistant.last?.result?.conclusion).toContain(out?.anchors[0] ?? '')
    expect(assistant.last?.result?.conclusion).not.toContain('当前没有未关闭的红色事件')
    markDatasetReset('2026-09-29T20:00:00.000Z')
    expect(assistant.guideActive).toBe(false)
    expect(assistant.guideEventId).toBe('')
  })
})

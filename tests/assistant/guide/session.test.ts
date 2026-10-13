/**
 * 导览阶段的重读与演示入口（§11 审核 ②③④）。
 *
 * 守三件事：
 * 1. **缓存以数据库为准**：阶段卡不在渲染里读库，只在明确时机（打开导览 / 从业务页返回 /
 *    刷新数据 / 手动重读）先重载 store 再算；未重读前保持上一份，不假装知道新状态；
 * 2. 重读**只读不写**；
 * 3. 演示入口（影像对比、现场任务页）只引导到现有页面，不替人写演示数据。
 */
import { describe, expect, it } from 'vitest'
import { buildStagePlan } from '@/assistant/guide/stage'
import { buildSnapshot } from '@/assistant/selectors'
import { useAssistantStore } from '@/assistant/session'
import { markDatasetReset } from '@/stores/demo/registry'
import { db } from '@/db/database'
import { makeEvent, makeIssue, makeWorkOrder } from '../../fixtures'
import { setupHarness } from '../harness'

async function chain() {
  const event = makeEvent({ id: 'evt_1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red', status: 'handling' })
  const issue = makeIssue({ id: 'iss_1', issueNo: 'ISS-20260920-001', eventId: 'evt_1', status: 'repairing', workOrderIds: ['wo_1'] })
  const order = makeWorkOrder({
    id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_1', eventId: 'evt_1', pointId: 'pnt_1',
    status: 'created', assignee: '', assignedAt: null, submittedAt: null, reviews: [],
  })
  return setupHarness({ events: [event], issues: [issue], workOrders: [order] })
}

describe('导览阶段的重读', () => {
  it('库改了：未重读前保持上一份，重读后立刻跟上（不假装知道新状态）', async () => {
    await chain()
    const assistant = useAssistantStore()
    await assistant.ask('带我演示处理流程')
    await assistant.rereadGuide()
    expect(assistant.guideActive).toBe(true)
    expect(assistant.guidePlan?.stage).toBe('work_order_dispatch')
    expect(assistant.guidePlan?.orderNo).toBe('WO-20260920-001')

    // 别处把工单推进到待验收（模拟在业务页完成的动作）
    await db.workOrders.update('wo_1', { status: 'submitted' })
    expect(assistant.guidePlan?.stage).toBe('work_order_dispatch')

    await assistant.rereadGuide()
    expect(assistant.guidePlan?.stage).toBe('work_order_verify')
    expect(assistant.guidePlan?.nextRole).toBe('学校安全管理人员')
    expect(assistant.guideLoading).toBe(false)
  })

  it('重读只读不写：记录 / 事件 / 问题 / 工单 / 日志计数不变', async () => {
    await chain()
    const assistant = useAssistantStore()
    await assistant.ask('带我演示处理流程')
    const before = await counts()
    await assistant.rereadGuide()
    await assistant.refresh()
    expect(await counts()).toEqual(before)
  })

  it('点「刷新数据」同样会重读阶段（推进时钟 + 重算）', async () => {
    await chain()
    const assistant = useAssistantStore()
    await assistant.ask('带我演示处理流程')
    await assistant.rereadGuide()
    await db.issues.update('iss_1', { status: 'pending_recheck' })
    await assistant.refresh()
    expect(assistant.guidePlan?.stage).toBe('issue_recheck')
  })

  it('重读进行中结束导览：在途那次结果不会把旧计划写回来', async () => {
    await chain()
    const assistant = useAssistantStore()
    await assistant.ask('带我演示处理流程')
    await assistant.rereadGuide()
    expect(assistant.guidePlan).not.toBeNull()

    const inflight = assistant.rereadGuide() // 故意不 await：模拟"读取还没回来"
    assistant.endGuide()
    await inflight

    expect(assistant.guideActive).toBe(false)
    expect(assistant.guidePlan).toBeNull()
    expect(assistant.guideLoading).toBe(false)
  })

  it('重读进行中重置数据集：同样丢弃在途结果，旧上下文一起清掉', async () => {
    await chain()
    const assistant = useAssistantStore()
    await assistant.ask('带我演示处理流程')
    await assistant.rereadGuide()
    expect(assistant.guidePlan).not.toBeNull()

    const inflight = assistant.rereadGuide()
    markDatasetReset('2026-09-30T01:00:00.000Z')
    await inflight

    expect(assistant.guideActive).toBe(false)
    expect(assistant.guidePlan).toBeNull()
    expect(assistant.context.eventId).toBeUndefined()
  })

  it('结束导览后计划清空，不再残留上一条事件的阶段', async () => {
    await chain()
    const assistant = useAssistantStore()
    await assistant.ask('带我演示处理流程')
    await assistant.rereadGuide()
    expect(assistant.guidePlan).not.toBeNull()
    assistant.endGuide()
    expect(assistant.guidePlan).toBeNull()
    // 结束之后即便触发重读也不会又冒出一份计划
    await assistant.rereadGuide()
    expect(assistant.guidePlan).toBeNull()
  })
})

describe('影像与巡检的演示入口', () => {
  it('阶段卡带两个入口：影像对比（带测点深链）与现场任务页（只到页面）', async () => {
    await chain()
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.demoLinks.map((link) => link.kind)).toEqual(['media_page', 'inspection_page'])
    const [media, inspection] = plan.demoLinks
    expect(media.deep).toBe(true)
    expect(media.query.point).toBe('pnt_1')
    // 巡检页不解析对象参数：不许写成"直达某点位"，只能到页面并写清进去点什么
    expect(inspection.deep).toBe(false)
    expect(inspection.note).toContain('模拟读卡')
    expect(inspection.note).toContain('我的任务')
  })

  it('测点已不在档案里时不给影像深链，避免死链', async () => {
    const event = makeEvent({ id: 'evt_1', pointId: 'pnt_gone', level: 'red', peakLevel: 'red', status: 'handling' })
    await setupHarness({ events: [event] })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.demoLinks.map((link) => link.kind)).toEqual(['inspection_page'])
  })
})

async function counts(): Promise<number[]> {
  return [
    await db.records.count(),
    await db.events.count(),
    await db.issues.count(),
    await db.workOrders.count(),
    await db.audits.count(),
  ]
}

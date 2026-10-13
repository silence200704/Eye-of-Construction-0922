/**
 * 同一事件处置阶段的只读推导（§8：阶段讲解与一键定位）。
 *
 * 守五件事：
 * 1. 同一条链上的事件 / 问题 / 工单**编号一致**，深链用的就是这些编号对应的内部 ID；
 * 2. 状态一变，阶段与下一责任角色立刻重算（不缓存旧结论）；
 * 3. 缓存过期以**数据库重读**为准：库改了但 store 没重载，导出的计划仍按 store 说话，
 *    重载后立即跟上——不存在"用旧快照编一个已完成"的路径；
 * 4. 断链或多候选时报原因并要求选择，**不猜编号**；
 * 5. 提问与看计划**零写库**。
 */
import { describe, expect, it } from 'vitest'
import { buildStagePlan } from '@/assistant/guide/stage'
import { buildSnapshot } from '@/assistant/selectors'
import { db } from '@/db/database'
import { makeEvent, makeIssue, makeWorkOrder } from '../../fixtures'
import { setupHarness } from '../harness'

const CHAIN = {
  event: makeEvent({ id: 'evt_1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red', status: 'handling' }),
  issue: makeIssue({ id: 'iss_1', issueNo: 'ISS-20260920-001', eventId: 'evt_1', status: 'repairing', workOrderIds: ['wo_1'] }),
}

async function chainHarness(overrides: { orderStatus?: Parameters<typeof makeWorkOrder>[0]['status']; issue?: Parameters<typeof makeIssue>[0] } = {}) {
  const order = makeWorkOrder({
    id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_1', eventId: 'evt_1', pointId: 'pnt_1',
    status: overrides.orderStatus ?? 'created', assignee: '', assignedAt: null, submittedAt: null, reviews: [],
  })
  const issue = { ...CHAIN.issue, ...(overrides.issue ?? {}) }
  return setupHarness({ events: [CHAIN.event], issues: [issue], workOrders: [order] })
}

describe('事件处置阶段（只读）', () => {
  it('同一事件→问题→工单编号一致，深链指向同一批内部 ID', async () => {
    await chainHarness()
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.eventNo).toBe('E20260920-001')
    expect(plan.issueNo).toBe('ISS-20260920-001')
    expect(plan.orderNo).toBe('WO-20260920-001')
    expect(plan.stage).toBe('work_order_dispatch')
    expect(plan.step).toBe(3)
    expect(plan.totalSteps).toBe(7)
    expect(plan.nextRole).toBe('学校安全管理人员')
    expect(plan.missing).toEqual(['指定维修人与期限后派工'])
    // 主按钮是工单所属问题详情，另一个入口是问题详情；都走白名单深链，不拼路由
    expect(plan.links.map((link) => link.kind)).toEqual(['workorder_detail', 'issue_detail'])
    expect(plan.links[0]?.query.workOrder).toBe('wo_1')
    expect(plan.links[1]?.query.issue).toBe('iss_1')
  })

  it('工单状态推进时阶段、步骤与责任角色逐步重算', async () => {
    await chainHarness()
    const stages: string[] = []
    for (const [status, expected] of [
      ['assigned', { stage: 'work_order_repair', step: 4, nextRole: '被派工的人（维修人员 / 物业值班）' }],
      ['repairing', { stage: 'work_order_repair', step: 4, nextRole: '维修人员' }],
      ['submitted', { stage: 'work_order_verify', step: 5, nextRole: '学校安全管理人员' }],
    ] as const) {
      await db.workOrders.update('wo_1', { status, assignee: status === 'assigned' ? '维修人员' : '维修人员' })
      await db.issues.update('iss_1', { status: status === 'submitted' ? 'repairing' : 'repairing' })
      await setupStores()
      const plan = buildStagePlan(buildSnapshot(), 'evt_1')
      expect(plan, status).toMatchObject(expected)
      stages.push(plan.title)
    }
    expect(stages).toEqual(['已派工待接单', '维修处理中', '待验收'])
  })

  it('验收通过后落在待复查：系统不替人下复查结论', async () => {
    await chainHarness({ orderStatus: 'verified', issue: { status: 'pending_recheck' } })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan).toMatchObject({ stage: 'issue_recheck', step: 6, title: '待复查' })
    expect(plan.missing.join()).toContain('复查')
    expect(plan.detail).toContain('不会自动关闭')
  })

  it('已登记未结论的一轮：给出责任人、目标日期与工单号，不让人自己找', async () => {
    const round = { subject: '复测裂缝宽度', owner: '王老师（物业值班）', dueDate: '2026-10-06', at: '2026-09-29T02:00:00.000Z', by: '演示操作员', outcome: null, outcomeAt: null, outcomeBy: '', outcomeNote: '' }
    await chainHarness({ orderStatus: 'verified', issue: { status: 'pending_recheck', rechecks: [round] } })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('issue_recheck')
    expect(plan.nextRole).toContain('王老师（物业值班）')
    expect(plan.missing[0]).toContain('2026-10-06')
    expect(plan.detail).toContain('复测裂缝宽度')
    // 待复查阶段也带上把问题送到这里的那张工单编号，三处编号同源
    expect(plan.orderNo).toBe('WO-20260920-001')
  })

  it('观察中且已有过结论：仍缺的是"下一轮结论"，不重复要求登记', async () => {
    const done = { subject: '复测裂缝宽度', owner: '王老师', dueDate: '2026-09-28', at: '2026-09-27T02:00:00.000Z', by: '演示操作员', outcome: 'observing' as const, outcomeAt: '2026-09-28T02:00:00.000Z', outcomeBy: '演示操作员', outcomeNote: '继续观察一周期' }
    await chainHarness({ orderStatus: 'verified', issue: { status: 'observing', rechecks: [done] } })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('issue_observing')
    expect(plan.missing[0]).toContain('本轮复查结论')
    expect(plan.missing[0]).not.toContain('登记复查事项')
  })

  it('缓存过期以数据库重读为准：不重载 store 就不会假装知道新状态', async () => {
    await chainHarness()
    await db.workOrders.update('wo_1', { status: 'submitted' })
    // 尚未重载 store：计划仍按上一份快照说话，不凭数据库里"更新"的状态编结论
    expect(buildStagePlan(buildSnapshot(), 'evt_1').stage).toBe('work_order_dispatch')
    await setupStores()
    expect(buildStagePlan(buildSnapshot(), 'evt_1').stage).toBe('work_order_verify')
  })

  it('多候选不猜：事件关联多条问题时要求选定，并给出各自深链', async () => {
    const second = makeIssue({ id: 'iss_2', issueNo: 'ISS-20260920-002', eventId: 'evt_1', status: 'pending_review', workOrderIds: [] })
    await setupHarness({
      events: [CHAIN.event],
      issues: [CHAIN.issue, second],
      workOrders: [makeWorkOrder({ id: 'wo_1', issueId: 'iss_1', eventId: 'evt_1', status: 'created', assignee: '' })],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.title).toContain('多条关联问题')
    expect(plan.candidates.map((row) => row.label)).toEqual(['ISS-20260920-001（处理中）', 'ISS-20260920-002（待审核）'])
    expect(plan.candidates.map((row) => row.link.query.issue)).toEqual(['iss_1', 'iss_2'])
    // 两条候选时连编号都只作提示（列出全部），但工单号一律不报 —— 任何一张都可能不是要讲的那条
    expect(plan.orderNo).toBe('')
  })

  it('已关闭事件也要先消歧：多条问题时只列候选，不把第一条说成唯一关联', async () => {
    const second = makeIssue({ id: 'iss_2', issueNo: 'ISS-20260924-002', eventId: 'evt_1', status: 'closed', workOrderIds: [] })
    await setupHarness({
      events: [{ ...CHAIN.event, status: 'closed' }],
      issues: [{ ...CHAIN.issue, status: 'closed' }, second],
      workOrders: [makeWorkOrder({ id: 'wo_1', issueId: 'iss_1', eventId: 'evt_1', status: 'verified' })],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.title).toContain('多条关联问题')
    expect(plan.issueNo).toBe('ISS-20260920-001、ISS-20260924-002')
    expect(plan.orderNo).toBe('')
    expect(plan.candidates).toHaveLength(2)
  })

  it('已关闭事件名下多条工单：同样要求选定，不取第一张', async () => {
    const second = makeWorkOrder({ id: 'wo_2', orderNo: 'WO-20260921-002', issueId: 'iss_1', eventId: 'evt_1', status: 'verified' })
    await setupHarness({
      events: [{ ...CHAIN.event, status: 'closed' }],
      issues: [{ ...CHAIN.issue, status: 'closed', workOrderIds: ['wo_1', 'wo_2'] }],
      workOrders: [makeWorkOrder({ id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_1', eventId: 'evt_1', status: 'verified' }), second],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.title).toContain('多张工单')
    expect(plan.candidates.map((row) => row.label)).toEqual(['WO-20260920-001（verified）', 'WO-20260921-002（verified）'])
    expect(plan.orderNo).toBe('')
  })

  it('工单没登记事件号：阶段照真实状态给，但必须带"归属未直接核实"说明', async () => {
    await setupHarness({
      events: [CHAIN.event],
      issues: [CHAIN.issue],
      // 演示数据里事件转出的工单也有 eventId 为空的情形：归属只能经问题间接核实
      workOrders: [makeWorkOrder({ id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_1', eventId: null, status: 'repairing', assignee: '维修人员' })],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('work_order_repair')
    expect(plan.verifyNotes.join()).toContain('没有直接登记事件号')
    expect(plan.verifyNotes.join()).toContain('ISS-20260920-001')
    // 归属说明与断链原因是两回事：这条链不断，所以 gaps 为空
    expect(plan.gaps).toEqual([])
  })

  it('问题处于处理中却没有工单：报断链并指向问题详情，不给"下一步"编动作', async () => {
    await setupHarness({
      events: [CHAIN.event],
      issues: [{ ...CHAIN.issue, workOrderIds: [] }],
      workOrders: [],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.detail).toContain('找不到它名下的工单')
    expect(plan.links.map((link) => link.kind)).toEqual(['issue_detail'])
    expect(plan.orderNo).toBe('')
  })

  it('工单直接登记了本事件时不产生归属说明', async () => {
    await chainHarness({ orderStatus: 'repairing' })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.verifyNotes).toEqual([])
  })

  it('问题登记了不存在的工单：断链如实写进 gaps，不静默忽略', async () => {
    await setupHarness({
      events: [CHAIN.event],
      issues: [{ ...CHAIN.issue, workOrderIds: ['wo_gone'] }],
      workOrders: [],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.gaps.join()).toContain('wo_gone')
    expect(plan.gaps.join()).toContain('当前数据集里没有这张工单')
  })

  it('工单登记的事件与当前事件不一致：只给"链路待人工核对"，不给维修中', async () => {
    await setupHarness({
      events: [CHAIN.event],
      issues: [CHAIN.issue],
      workOrders: [makeWorkOrder({ id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_1', eventId: 'evt_other', status: 'repairing', assignee: '维修人员' })],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.title).toBe('链路待人工核对')
    expect(plan.gaps.join()).toContain('登记的事件与')
    expect(plan.nextRole).toBe('学校安全管理人员')
    expect(plan.missing).toEqual(['到下面的原业务页面核对后再继续'])
  })

  it('问题登记的工单实际归属别的问题：双向错归属也算断链', async () => {
    const other = makeIssue({ id: 'iss_other', issueNo: 'ISS-20260920-009', eventId: null, status: 'repairing', workOrderIds: [] })
    await setupHarness({
      events: [CHAIN.event],
      issues: [{ ...CHAIN.issue, workOrderIds: ['wo_1'] }, other],
      // 这张工单归属的是 iss_other，而 iss_1 也登记了它 —— 两个方向对不上
      workOrders: [makeWorkOrder({ id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_other', eventId: null, status: 'repairing', assignee: '维修人员' })],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.gaps.join()).toContain('实际归属别的问题')
  })

  it('工单归属本事件的问题，但问题没有反向登记它：反向缺失同样断链', async () => {
    await setupHarness({
      events: [CHAIN.event],
      issues: [{ ...CHAIN.issue, workOrderIds: [] }],
      workOrders: [makeWorkOrder({ id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_1', eventId: 'evt_1', status: 'repairing', assignee: '维修人员' })],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('chain_broken')
    expect(plan.gaps.join()).toContain('没有反向登记这张工单')
  })

  it('事件已关闭只作回看；问题仍开放时只说"按原入口继续"，不判定能否关闭', async () => {
    await setupHarness({
      events: [{ ...CHAIN.event, status: 'closed' }],
      issues: [{ ...CHAIN.issue, status: 'pending_recheck' }],
      workOrders: [makeWorkOrder({ id: 'wo_1', orderNo: 'WO-20260920-001', issueId: 'iss_1', eventId: 'evt_1', status: 'verified' })],
    })
    const plan = buildStagePlan(buildSnapshot(), 'evt_1')
    expect(plan.stage).toBe('event_closed')
    expect(plan.step).toBe(7)
    expect(plan.detail).toContain('已关闭')
    // 事件关了不等于问题也关了：仍开放的复查事项照实报出，但不替人判定"能不能关闭"
    expect(plan.nextRole).toBe('学校安全管理人员')
    expect(plan.missing.join()).toContain('ISS-20260920-001')
    expect(plan.missing.join()).toContain('待复查')
  })

  it('事件不存在时不编编号，直接说失效', async () => {
    await chainHarness()
    const plan = buildStagePlan(buildSnapshot(), 'evt_deleted')
    expect(plan.stage).toBe('stale')
    expect(plan.eventNo).toBe('')
    expect(plan.links).toEqual([])
  })

  it('看阶段与提问都不写库（记录 / 事件 / 问题 / 工单 / 日志全不变）', async () => {
    const h = await chainHarness()
    const before = await counts()
    buildStagePlan(buildSnapshot(), 'evt_1')
    await h.ask('带我演示处理流程')
    await h.ask('这个预警下一步怎么办')
    expect(await counts()).toEqual(before)
  })
})

async function setupStores(): Promise<void> {
  const { useEventsStore } = await import('@/stores/events')
  const { useIssueStore } = await import('@/stores/inspection/issues')
  const { useWorkOrderStore } = await import('@/stores/inspection/workOrders')
  await useEventsStore().reload()
  await useIssueStore().reload()
  await useWorkOrderStore().reload()
}

async function counts(): Promise<number[]> {
  return [
    await db.records.count(),
    await db.events.count(),
    await db.issues.count(),
    await db.workOrders.count(),
    await db.audits.count(),
  ]
}

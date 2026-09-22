/**
 * 事件授权关闭的处置依据测试。
 *
 * 关闭是一条链的收尾：预警 → 问题 → 工单 → 验收 → 复测 → 关闭。
 * 三道门缺一不可 —— 权限与时机（planClose）、处置依据（closeBasis）、依据必须落在库里（读库复核）。
 * 其中"处置依据"要求：**关联工单已验收通过**，或安全管理人员写明的"无需维修"现场核查结论。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useEventsStore } from '@/stores/events'
import { useSessionStore } from '@/stores/session'
import type { InspectionIssue, WorkOrder, WorkOrderStatus } from '@/types/inspection'
import { makeEvent } from '../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const NOTE = '现场核查确认无需维修，探头读数已恢复正常，经安全管理人员确认'

function issue(override: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    ...AUDIT,
    id: 'iss_1',
    issueNo: 'ISS-20260920-001',
    source: 'sensor',
    submissionKey: 'event:evt_1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    eventId: 'evt_1',
    taskId: null,
    anomalyType: '裂缝扩展',
    description: '预警转问题',
    photos: [],
    status: 'repairing',
    reviewAction: null,
    reviewCategory: '',
    reviewedAt: null,
    reviewedBy: '',
    reviewNote: '',
    duplicateOf: null,
    linkedEventId: null,
    linkedFrom: [],
    workOrderIds: ['wo_1'],
    timeline: [],
    ...override,
  }
}

function order(status: WorkOrderStatus, override: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...AUDIT,
    id: 'wo_1',
    orderNo: 'WO-20260920-001',
    origin: 'event',
    issueId: 'iss_1',
    eventId: 'evt_1',
    pointId: 'pnt_1',
    title: '裂缝扩展处理',
    status,
    assignee: '维修人员',
    assignedBy: '安全管理员',
    assignedAt: AT,
    dueAt: null,
    measures: '封闭处理',
    materials: '',
    photos: [],
    submittedAt: AT,
    reviews: [],
    timeline: [],
    ...override,
  }
}

async function setup(input: { status?: string; orders?: WorkOrder[]; issues?: InspectionIssue[]; role?: string } = {}): Promise<void> {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  const session = useSessionStore()
  session.name = '安全管理员'
  session.role = input.role ?? 'safety'
  await db.events.put(makeEvent({ status: (input.status ?? 'recovering') as 'recovering' }))
  if (input.orders !== undefined) await db.workOrders.bulkPut(input.orders)
  if (input.issues !== undefined) await db.issues.bulkPut(input.issues)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('事件授权关闭的处置依据', () => {
  it('既没有验收工单也没有核查结论：拒绝关闭，事件保持恢复待确认', async () => {
    await setup({ orders: [order('submitted')], issues: [issue()] })
    const events = useEventsStore()
    await events.load()

    await expect(events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值', noRepairNote: '' })).rejects.toThrow(
      '关闭前还缺处置依据',
    )
    const event = await db.events.get('evt_1')
    expect(event?.status).toBe('recovering')
    expect(event?.closeBasis).toBe('')
  })

  it('关联工单已验收通过：可以关闭，且在事件与问题两端都留下同一条依据', async () => {
    await setup({ orders: [order('verified')], issues: [issue()] })
    const events = useEventsStore()
    await events.load()
    const logsBefore = await db.audits.count()

    await events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值，现场复查无新增裂缝', noRepairNote: '' })

    const event = await db.events.get('evt_1')
    expect(event?.status).toBe('closed')
    expect(event?.closedBy).toBe('安全管理员')
    expect(event?.closeBasis).toContain('连续三次复测')
    expect(event?.timeline.at(-1)?.action).toBe('关闭事件')
    // 事件的关闭时间线要写清处置依据是"哪张工单验收通过"，不能只写一句"已关闭"
    expect(event?.timeline.at(-1)?.detail).toContain('WO-20260920-001 已验收通过')

    // 问题侧：只追加时间线，**不改状态**（问题关闭有它自己的审核出口）
    const row = await db.issues.get('iss_1')
    expect(row?.status).toBe('repairing')
    expect(row?.timeline.at(-1)?.action).toBe('关联预警事件已关闭')
    expect(row?.timeline.at(-1)?.detail).toContain('WO-20260920-001 已验收通过')

    // 审计日志：事件一条 + 关联问题一条
    expect(await db.audits.count()).toBe(logsBefore + 2)
  })

  it('同一测点的旧事件工单不能作为当前事件的关闭依据', async () => {
    await setup({
      orders: [order('verified', { id: 'wo_old', orderNo: 'WO-20260919-001', eventId: 'evt_old', issueId: 'iss_old' })],
      issues: [],
    })
    const events = useEventsStore()
    await events.load()

    await expect(events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值', noRepairNote: '' })).rejects.toThrow(
      '关闭前还缺处置依据',
    )
    expect((await db.events.get('evt_1'))?.status).toBe('recovering')
  })

  it('没有工单但安全管理人员写明"无需维修"核查结论：可以关闭', async () => {
    await setup({ orders: [], issues: [] })
    const events = useEventsStore()
    await events.load()

    await events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值', noRepairNote: NOTE })

    const event = await db.events.get('evt_1')
    expect(event?.status).toBe('closed')
    expect(event?.timeline.at(-1)?.detail).toContain('无需维修')
  })

  it('核查结论太短不算依据（不能拿两个字糊过去）', async () => {
    await setup({ orders: [], issues: [] })
    const events = useEventsStore()
    await events.load()

    await expect(events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值', noRepairNote: '无需维修' })).rejects.toThrow(
      '关闭前还缺处置依据',
    )
  })

  it('非安全管理人员不能关闭（仓储层拦截，与页面无关）', async () => {
    await setup({ orders: [order('verified')], issues: [issue()], role: 'property' })
    const events = useEventsStore()
    await events.load()

    await expect(events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值', noRepairNote: NOTE })).rejects.toThrow(
      '仅学校安全管理人员',
    )
    expect((await db.events.get('evt_1'))?.status).toBe('recovering')
  })

  it('不在恢复待确认状态不能关闭', async () => {
    await setup({ status: 'handling', orders: [order('verified')] })
    const events = useEventsStore()
    await events.load()

    await expect(events.closeEvent('evt_1', { basis: '看起来没问题了', noRepairNote: '' })).rejects.toThrow('恢复待确认')
  })

  it('关联问题写入失败时事件也不落地（不留"事件已关闭、问题时间线没有这条"）', async () => {
    await setup({ orders: [order('verified')], issues: [issue()] })
    const events = useEventsStore()
    await events.load()

    const original = db.issues.bulkPut.bind(db.issues)
    ;(db.issues as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟问题写入失败')
    }
    let failed = false
    try {
      await events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值', noRepairNote: '' })
    } catch {
      failed = true
    } finally {
      ;(db.issues as unknown as { bulkPut: unknown }).bulkPut = original
    }
    expect(failed).toBe(true)

    const event = await db.events.get('evt_1')
    expect(event?.status).toBe('recovering')
    expect((await db.issues.get('iss_1'))?.timeline).toHaveLength(0)

    // 恢复后重试：事件与问题一起成立
    await events.closeEvent('evt_1', { basis: '连续三次复测均低于恢复阈值', noRepairNote: '' })
    expect((await db.events.get('evt_1'))?.status).toBe('closed')
    expect((await db.issues.get('iss_1'))?.timeline).toHaveLength(1)
  })
})

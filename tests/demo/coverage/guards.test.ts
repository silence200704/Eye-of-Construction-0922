import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/database'
import { freshSeed, reloadAll } from '../harness'
import { loadCoverageScenario } from '@/stores/writes/demo/coverage'
import { prepareExtraArchive, CLOSED_CRACK, READY_CRACK } from '@/stores/writes/demo/coverage/archive'
import { useEventsStore } from '@/stores/events'
import { useSessionStore } from '@/stores/session'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { importHistoryTimes } from '@/stores/writes/demo/coverage/historyTime'

describe('临时案例不覆盖既有数据或现场办理进度', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T10:00:00+08:00'))
    await freshSeed(); await reloadAll()
  })
  afterEach(() => vi.useRealTimers())

  it('重复准备业务数据逐字一致，只追加载入日志', async () => {
    await loadCoverageScenario()
    const tables = db.tables.filter((table) => table.name !== 'audits')
    const before = JSON.stringify(await Promise.all(tables.map((table) => table.toArray())))
    const again = await loadCoverageScenario()
    expect(again.created).toBe(0)
    expect(JSON.stringify(await Promise.all(tables.map((table) => table.toArray())))).toBe(before)
  })

  it('已确认红色事件和已接单工单不会被重置为待处理，当前身份不改变', async () => {
    await loadCoverageScenario()
    const event = await db.events.where('pointId').equals(READY_CRACK).first()
    useSessionStore().setIdentity('现场管理员', 'safety')
    await useEventsStore().acknowledgeEvent(event?.id ?? '')
    const order = await db.workOrders.filter((row) => row.status === 'assigned').first()
    useSessionStore().setIdentity('维修人员', 'repair')
    const taken = await useWorkOrderStore().advanceOrder(order?.id ?? '', 'repairing', {})
    expect(taken.ok).toBe(true)
    await loadCoverageScenario()
    expect((await db.events.get(event?.id ?? ''))?.status).toBe('handling')
    expect((await db.workOrders.get(order?.id ?? ''))?.status).toBe('repairing')
    expect(useSessionStore().name).toBe('维修人员')
    expect(useSessionStore().role).toBe('repair')
  })

  it('归档的新点不自动复活，也不写出半截新增档案', async () => {
    await prepareExtraArchive()
    await db.points.update(READY_CRACK, { status: 'archived' })
    await expect(prepareExtraArchive()).rejects.toThrow('已归档')
    expect((await db.points.get(READY_CRACK))?.status).toBe('archived')
  })

  it('新增编号被手工档案占用时拒绝整个新增档案事务', async () => {
    const original = await db.points.get('pnt_b03_f2_crack01')
    if (original === undefined) throw new Error('缺种子点')
    await db.points.add({ ...original, id: 'manual_conflict', code: 'B03-F3-CRACK02', remark: '手工数据' })
    const before = await db.points.count()
    await expect(prepareExtraArchive()).rejects.toThrow('编号已被占用')
    expect(await db.points.count()).toBe(before)
    expect(await db.points.get(READY_CRACK)).toBeUndefined()
  })

  it('历史时间轴只可导入一次，不重写已完成案例或用户修订', async () => {
    await loadCoverageScenario()
    const event = await db.events.where('pointId').equals(CLOSED_CRACK).first()
    const issue = await db.issues.where('eventId').equals(event?.id ?? '').first()
    const order = await db.workOrders.get(issue?.workOrderIds[0] ?? '')
    if (event === undefined || issue === undefined || order === undefined) throw new Error('缺历史案例')
    const before = JSON.stringify([event, issue, order])
    await expect(importHistoryTimes({ event, issue, order })).rejects.toThrow('不得再次改写')
    expect(JSON.stringify([await db.events.get(event.id), await db.issues.get(issue.id), await db.workOrders.get(order.id)])).toBe(before)
  })
})

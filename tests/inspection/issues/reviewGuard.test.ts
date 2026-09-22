/**
 * 审核写入的守卫测试（P0-1 权限、P0-2 关联目标与双向留痕）。
 *
 * 验收口径（评审给定）：
 * ① 物业、巡检身份审核被拒，且问题、时间线、操作日志均不变；
 * ② 关联既有对象必须真实存在、不能指向自己；无效目标不产生半成品；
 * ③ 关联成功时源问题与目标问题（或事件）双方时间线都有记录；
 * ④ 同一审核动作快速重复提交不产生重复时间线与日志。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useIssueStore } from '@/stores/inspection/issues'
import { makeBuilding, makeEvent, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })

async function setup(role = 'safety'): Promise<void> {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  await db.buildings.put({ ...BLD })
  await db.floors.put({ ...FLR })
  await db.points.put({ ...PNT })
  const archive = useArchiveStore()
  archive.buildings = [BLD]
  archive.floors = [FLR]
  archive.points = [PNT]
  const session = useSessionStore()
  session.name = '张工'
  session.role = role
}

async function makeIssue(description: string, anomalyType = '探头松动'): Promise<string> {
  const issues = useIssueStore()
  const out = await issues.reportManualIssue({
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    anomalyType,
    description,
    photos: [],
    detail: description,
  })
  await issues.reload()
  return out.issue.id
}

const review = (extra: Record<string, unknown> = {}) => ({
  action: 'to_repair' as const,
  category: 'equipment',
  note: '现场确认可维修，转维修工单处理',
  ...extra,
})

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('P0-1 审核权限由仓储强制', () => {
  it('物业身份审核被拒：问题状态、时间线、操作日志都不变', async () => {
    await setup('property')
    const issues = useIssueStore()
    const id = await makeIssue('支架松动')
    const before = await db.issues.get(id)
    const logsBefore = await db.audits.count()

    const out = await issues.reviewIssue(id, review())
    expect(out.ok).toBe(false)
    expect(out.error).toContain('学校安全管理人员')

    const after = await db.issues.get(id)
    expect(after?.status).toBe(before?.status)
    expect(after?.timeline).toHaveLength(before?.timeline.length ?? 0)
    expect(await db.audits.count()).toBe(logsBefore)
  })

  it('巡检身份同样被拒', async () => {
    await setup('inspector')
    const issues = useIssueStore()
    const id = await makeIssue('支架松动')
    const out = await issues.reviewIssue(id, review())
    expect(out.ok).toBe(false)
  })

  it('转维修：问题状态与"待派工"工单在同一个事务里成立', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const id = await makeIssue('支架松动')
    const before = await db.audits.count()
    const out = await issues.reviewIssue(id, review())
    expect(out.ok).toBe(true)

    const after = await db.issues.get(id)
    expect(after?.status).toBe('repairing')
    expect(after?.reviewAction).toBe('to_repair')
    expect(after?.reviewCategory).toBe('equipment')
    expect(after?.timeline.at(-1)?.action).toContain('审核：转维修工单（设备故障）')

    // 工单确实建出来了，且是待派工、单号规范、指向这条问题
    const orders = await db.workOrders.toArray()
    expect(orders).toHaveLength(1)
    expect(orders[0].status).toBe('created')
    expect(orders[0].orderNo).toMatch(/^WO-\d{8}-\d{3}$/)
    expect(orders[0].issueId).toBe(id)
    expect(orders[0].origin).toBe('issue')
    expect(after?.workOrderIds).toEqual([orders[0].id])

    // 两条日志：审核一条、建单一条
    expect(await db.audits.count()).toBe(before + 2)
  })

  it('转维修建单失败时问题状态不落地（不出现"处理中但没有工单"）', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const id = await makeIssue('支架松动')
    const before = await db.issues.get(id)

    // 人为让工单表写入失败
    const original = db.workOrders.add.bind(db.workOrders)
    ;(db.workOrders as unknown as { add: unknown }).add = () => {
      throw new Error('模拟工单写入失败')
    }
    let failed = false
    try {
      await issues.reviewIssue(id, review())
    } catch {
      failed = true
    } finally {
      ;(db.workOrders as unknown as { add: unknown }).add = original
    }

    expect(failed).toBe(true)
    const after = await db.issues.get(id)
    expect(after?.status).toBe(before?.status)
    expect(after?.workOrderIds).toEqual([])
    expect(await db.workOrders.count()).toBe(0)

    // 恢复后重试：问题与工单一起成立
    const retry = await issues.reviewIssue(id, review())
    expect(retry.ok).toBe(true)
    expect(await db.workOrders.count()).toBe(1)
  })

  it('快速重复提交：第二次命中"问题已关闭/状态不符"的判定，不产生重复时间线', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const id = await makeIssue('支架松动')
    const payload = review({ action: 'close_no_fault', category: 'false_alarm', note: '现场核实为误报，无需处理' })

    const first = await issues.reviewIssue(id, payload)
    expect(first.ok).toBe(true)
    const timelineAfterFirst = (await db.issues.get(id))?.timeline.length ?? 0
    const logsAfterFirst = await db.audits.count()

    const second = await issues.reviewIssue(id, payload)
    expect(second.ok).toBe(false)
    expect(second.error).toContain('已关闭')
    expect((await db.issues.get(id))?.timeline.length).toBe(timelineAfterFirst)
    expect(await db.audits.count()).toBe(logsAfterFirst)
  })
})

describe('P0-2 关联既有对象', () => {
  it('关联到不存在的目标被拒，且不产生半成品', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const id = await makeIssue('第一次发现')
    const before = await db.issues.get(id)
    const logsBefore = await db.audits.count()

    const out = await issues.reviewIssue(id, review({ action: 'link_object', category: 'issue', note: '与已有问题同源', duplicateOf: 'iss_not_exist' }))
    expect(out.ok).toBe(false)
    expect(out.error).toContain('不存在')
    const after = await db.issues.get(id)
    expect(after?.status).toBe(before?.status)
    expect(after?.timeline).toHaveLength(before?.timeline.length ?? 0)
    expect(await db.audits.count()).toBe(logsBefore)
  })

  it('不能关联到自己', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const id = await makeIssue('第一次发现')
    const out = await issues.reviewIssue(id, review({ action: 'link_object', category: 'issue', note: '自关联测试', duplicateOf: id }))
    expect(out.ok).toBe(false)
    expect(out.error).toContain('自己')
  })

  it('关联成功：两条问题都在，双方时间线都有记录，目标带关联来源', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const targetId = await makeIssue('原问题：支架松动')
    const sourceId = await makeIssue('新问题：同一处再次上报', '外观破损')

    const out = await issues.reviewIssue(sourceId, review({
      action: 'link_object',
      category: 'issue',
      note: '同一处问题的重复上报，关联到原记录',
      duplicateOf: targetId,
    }))
    expect(out.ok).toBe(true)

    // 两条记录都还在
    expect(await db.issues.count()).toBe(2)
    const source = await db.issues.get(sourceId)
    const target = await db.issues.get(targetId)
    expect(source?.duplicateOf).toBe(targetId)
    expect(source?.timeline.at(-1)?.detail).toContain('关联到')
    expect(target?.linkedFrom).toEqual([sourceId])
    expect(target?.timeline.at(-1)?.action).toBe('被关联')
    expect(target?.timeline.at(-1)?.detail).toContain('关联到本条问题')
  })

  it('关联到已关闭问题：需要在审核意见里写明专门依据', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const targetId = await makeIssue('原问题：支架松动')
    await issues.reviewIssue(targetId, review({ action: 'close_no_fault', category: 'false_alarm', note: '现场核实为误报，无需处理' }))
    const sourceId = await makeIssue('新问题：同位置再次上报', '外观破损')

    const denied = await issues.reviewIssue(sourceId, review({
      action: 'link_object',
      category: 'issue',
      note: '重复',
      duplicateOf: targetId,
    }))
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('已关闭')

    const ok = await issues.reviewIssue(sourceId, review({
      action: 'link_object',
      category: 'issue',
      note: '同一处裂缝的复查上报，需与已关闭档案对照观察变化趋势',
      duplicateOf: targetId,
    }))
    expect(ok.ok).toBe(true)
    const target = await db.issues.get(targetId)
    expect(target?.linkedFrom).toEqual([sourceId])
  })

  it('关联预警事件：事件必须在库中，成功后在事件时间线留下节点', async () => {
    await setup('safety')
    const issues = useIssueStore()
    const id = await makeIssue('探头读数异常')

    const missing = await issues.reviewIssue(id, review({ action: 'link_object', category: 'event', note: '与预警同源', linkedEventId: 'evt_missing' }))
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('预警事件不存在')

    await db.events.put({ ...makeEvent({ id: 'evt_1', eventNo: 'E20260920-001', pointId: 'pnt_1' }) })
    const ok = await issues.reviewIssue(id, review({ action: 'link_object', category: 'event', note: '与同点位预警同源，合并观察', linkedEventId: 'evt_1' }))
    expect(ok.ok).toBe(true)

    const stored = await db.issues.get(id)
    expect(stored?.linkedEventId).toBe('evt_1')
    const event = await db.events.get('evt_1')
    expect(event?.timeline.at(-1)?.action).toBe('记录关联问题')
    expect(event?.timeline.at(-1)?.detail).toContain('关联到本事件')
  })
})

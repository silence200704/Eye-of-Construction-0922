/**
 * 工单相关测试的公共夹具。
 *
 * 抽出来的原因：正向链路（flow）与守卫（guards）两个文件都要"一栋楼 + 一层 + 一个测点 +
 * 一条已上报的问题"，各写一份会在改夹具时漏改一处（曾经就吃过"夹具缺字段导致假通过"的亏）。
 */
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useIssueStore } from '@/stores/inspection/issues'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })

/** 清库、建档、设定身份。每个用例开头调用一次。 */
export async function seedWorld(role = 'safety'): Promise<void> {
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
  session.name = '安全管理员'
  session.role = role
}

/** 人工上报一条问题（现场任何身份都能报），返回问题 ID。 */
export async function reportIssue(anomalyType = '探头松动'): Promise<string> {
  const issues = useIssueStore()
  const created = await issues.reportManualIssue({
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    anomalyType,
    description: '支架螺栓松动',
    photos: [],
    detail: '现场上报',
  })
  await issues.reload()
  return created.issue.id
}

/** 审核转维修建单：返回问题与"待派工"工单的 ID。 */
export async function setupRepairOrder(): Promise<{ issueId: string; orderId: string }> {
  await seedWorld('safety')
  const issueId = await reportIssue()
  const issues = useIssueStore()
  const reviewed = await issues.reviewIssue(issueId, {
    action: 'to_repair',
    category: 'equipment',
    note: '现场确认为支架松动，转维修工单处理',
  })
  if (!reviewed.ok) throw new Error(`转维修建单失败：${reviewed.error}`)
  const orders = await db.workOrders.toArray()
  return { issueId, orderId: orders[0].id }
}

/** 切身份（只改角色，姓名保持"安全管理员"，便于用姓名匹配被派工人的用例）。 */
export function act(role: string): void {
  const session = useSessionStore()
  session.role = role
}

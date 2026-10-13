/** 数据全面化只接到既有全链入口，不新增任何页面按钮或 AI 自动业务决定。 */
import { db } from '@/db/database'
import { WORK_ORDER_STATUSES } from '@/types/inspection'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useRecordsStore } from '@/stores/records'
import { logScenario, makeResult, type DemoScenarioResult } from '../support'
import { prepareExtraArchive } from './archive'
import { prepareQualitySamples, preparePendingRed } from './samples'
import { prepareClosedHistory } from './history'
import { prepareAssignedOrder, prepareCompletedInspection } from './inspection'

async function counts(): Promise<number> {
  const tables = [db.points, db.devices, db.baselines, db.rules, db.records, db.events, db.notifications, db.issues, db.workOrders, db.plans, db.tasks, db.attachments]
  return (await Promise.all(tables.map((table) => table.count()))).reduce((sum, n) => sum + n, 0)
}

export async function loadCoverageScenario(): Promise<DemoScenarioResult> {
  const before = await counts()
  await prepareExtraArchive()
  await prepareQualitySamples()
  const historyId = await prepareClosedHistory()
  const taskId = await prepareCompletedInspection()
  const orderId = await prepareAssignedOrder()
  // 最后准备红色待处理，避免历史案例的通知抢占现场待处理强提醒。
  const redId = await preparePendingRed()
  await Promise.all([useEventsStore().reload(), useIssueStore().reload(), useWorkOrderStore().reload(), useRecordsStore().reload()])
  const red = useEventsStore().byId(redId)
  const history = useEventsStore().byId(historyId)
  const order = useWorkOrderStore().byId(orderId)
  const orderStatus = WORK_ORDER_STATUSES.find((row) => row.key === order?.status)?.name ?? '状态待核对'
  const created = await counts() - before
  const message = `数据全面化：5 个附加传感器测点（共享 2D/3D 坐标）；待处理案例 ${red?.eventNo}（${useEventsStore().statusLabel(red?.status ?? 'pending')}）；历史闭环 ${history?.eventNo}；已完成巡检（含错码尝试与巡检来源问题）；待接单样例 ${order?.orderNo}（当前 ${orderStatus}）；存疑/无效/过期样例；历史耗时为模拟值。不扩展墙体照片对。`
  await logScenario('coverage', '数据全面化补齐', message)
  return makeResult('coverage', true, message, { created, skipped: created === 0 ? 1 : 0,
    anchors: [red?.eventNo ?? redId, history?.eventNo ?? historyId, order?.orderNo ?? orderId],
    anchorRefs: [{ kind: 'event', id: redId }, { kind: 'event', id: historyId }, { kind: 'inspectionTask', id: taskId }, { kind: 'workOrder', id: orderId }],
    focus: { path: '/alarms', query: { event: redId } },
  })
}

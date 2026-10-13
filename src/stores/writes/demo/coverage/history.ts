/** 独立历史案例：执行原有审核、维修、验收、复查及关闭入口，不触碰当前待操作案例。 */
import { CRACK_SAMPLES, demoSampleTime, demoScriptBase } from '@/config/demoScript'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useRecordsStore } from '@/stores/records'
import { db } from '@/db/database'
import { todayInput } from '@/core/time'
import { withActor } from '../support'
import { reachTarget, type OrderSpec } from '../workOrder'
import { CLOSED_CRACK, COVERAGE_NOTE } from './archive'
import { addSample } from './samples'
import { importHistoryTimes } from './historyTime'

export async function prepareClosedHistory(options: { resume?: boolean } = {}): Promise<string> {
  const events = useEventsStore()
  const issues = useIssueStore()
  const orders = useWorkOrderStore()
  await Promise.all([events.reload(), issues.reload(), orders.reload()])
  const existing = events.events.find((row) => row.pointId === CLOSED_CRACK)
  if (existing !== undefined) {
    if (await db.audits.get(`demo:history-times:${existing.id}`)) return existing.id
    if (!options.resume) throw new Error('历史案例存在未完成数据，请人工核对；未继续改写')
  }
  await useRecordsStore().reload()
  const rows = useRecordsStore().ofPoint(CLOSED_CRACK)
  if (rows.length && (!options.resume || rows.some(row => !row.note.startsWith(COVERAGE_NOTE) || !row.note.includes('历史闭环：')))) throw new Error('历史案例已有其他采样，拒绝覆盖')
  const first = rows.find(row => row.note.includes(`历史闭环：${CRACK_SAMPLES[0]!.label}`))
  const base = first ? new Date(first.sampleTime) : demoScriptBase()
  for (const sample of CRACK_SAMPLES.slice(0, 4)) await addSample({ pointId: CLOSED_CRACK, values: sample.values, unit: 'mm', sampleTime: demoSampleTime(sample, base), tag: `历史闭环：${sample.label}` })
  await events.reload()
  const pending = events.events.find((row) => row.pointId === CLOSED_CRACK)
  if (!pending) throw new Error('历史案例未形成可确认的事件')
  if (pending.acknowledgedAt === null) await withActor('safety', () => events.acknowledgeEvent(pending.id))
  for (const sample of CRACK_SAMPLES.slice(4)) await addSample({ pointId: CLOSED_CRACK, values: sample.values, unit: 'mm', sampleTime: demoSampleTime(sample, base), tag: `历史闭环：${sample.label}` })
  await events.reload()
  const event = events.events.find((row) => row.pointId === CLOSED_CRACK)
  if (!event || !['recovering','closed'].includes(event.status)) throw new Error('历史案例尚未满足连续恢复条件')
  const spec: OrderSpec = { tag: '历史闭环', pointId: CLOSED_CRACK, buildingId: 'bld_b03', floorId: 'flr_b03_03', zoneId: '三层走廊', anomalyType: '测点固定件松动', summary: '现场核查固定件松动，维修后复测恢复；结构安全仍以专业评估为准。', target: 'verified' }
  const result = await withActor('safety', () => issues.createIssueFromEvent({ ...spec, eventId: event.id, description: `${COVERAGE_NOTE} 历史闭环：${spec.summary}`, photos: [], detail: '历史测试案例准备；非 AI 决策' }))
  const issue = result.issue
  if (issue.status === 'pending_review') {
    const reviewed = await withActor('safety', () => issues.reviewIssue(issue.id, { action: 'to_repair', category: 'equipment', note: '固定件松动已确认，安排设备维修并持续结构复测' }))
    if (!reviewed.ok) throw new Error(reviewed.error)
  }
  await orders.reload()
  const order = orders.ordersOfIssue(issue.id)[0]
  if (order === undefined) throw new Error('历史案例未生成工单')
  const failure = await reachTarget(spec, order.id)
  if (failure !== '') throw new Error(failure)
  await finishRecheck(issue.id, event.id)
  const complete = { event: await db.events.get(event.id), issue: await db.issues.get(issue.id), order: await db.workOrders.get(order.id) }
  if (complete.event === undefined || complete.issue === undefined || complete.order === undefined) throw new Error('历史案例关联对象缺失')
  await importHistoryTimes({ event: complete.event, issue: complete.issue, order: complete.order })
  await Promise.all([events.reload(), issues.reload(), orders.reload(), useRecordsStore().reload()])
  return event.id
}

async function finishRecheck(issueId: string, eventId: string): Promise<void> {
  await withActor('safety', async () => {
    const issues = useIssueStore()
    if (!issues.byId(issueId)?.rechecks?.length) {
      const register = await issues.registerRecheck(issueId, { subject: '设备固定复核与连续恢复复测', owner: '李老师（后勤保障处）', dueDate: todayInput() })
      if (!register.ok) throw new Error(register.error)
    }
    if (issues.byId(issueId)?.status !== 'closed') {
      const outcome = await issues.recordRecheckOutcome(issueId, { outcome: 'recovered', note: '已复核固定情况，连续复测低于恢复阈值；历史测试结论' })
      if (!outcome.ok) throw new Error(outcome.error)
    }
    if (useEventsStore().byId(eventId)?.status !== 'closed') await useEventsStore().closeEvent(eventId, { basis: '关联设备维修工单已验收通过，连续三条复测满足恢复条件；历史测试案例。', noRepairNote: '' })
  })
}

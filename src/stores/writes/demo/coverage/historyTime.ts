/** 新生成历史测试案例的时间轴导入。仅调时间，不改状态；不重写任何既有案例。 */
import { db } from '@/db/database'
import { buildAuditLog } from '@/db/repo'
import { toPlain } from '@/core/plain'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'
import { CLOSED_CRACK, COVERAGE_NOTE } from './archive'

interface HistoryInput { event: AlarmEvent; issue: InspectionIssue; order: WorkOrder }
const shift = (iso: string, hours: number): string => new Date(Date.parse(iso) + hours * 3_600_000).toISOString()

/** 所有状态均已由原写入口产生；导入的是预设历史业务时刻，实际准备操作日志仍记当前时间。 */
export async function importHistoryTimes(input: HistoryInput): Promise<void> {
  const { event, issue, order } = input
  if (event.pointId !== CLOSED_CRACK || issue.eventId !== event.id || order.issueId !== issue.id || order.eventId !== event.id || !issue.workOrderIds.includes(order.id)) throw new Error('历史案例关联不一致，拒绝导入时间轴')
  if (event.status !== 'closed' || issue.status !== 'closed' || order.status !== 'verified') throw new Error('历史案例尚未完成原业务闭环')
  const key = `demo:history-times:${event.id}`
  const red = event.evidences.find((row) => row.level === 'red')
  if (red === undefined) throw new Error('历史案例缺红色证据')
  const triggerAt = shift(red.sampleTime, 5 / 60)
  const records = await db.records.where('pointId').equals(CLOSED_CRACK).toArray()
  const notes = await db.notifications.where('eventId').equals(event.id).toArray()
  if (records.some((row) => row.revision !== 0 || !row.note.startsWith(COVERAGE_NOTE))) throw new Error('历史案例记录已修改，不导入模拟时间轴')
  const lastSample = records.map((row) => row.sampleTime).sort().pop()
  const recheckAt = shift(lastSample ?? triggerAt, 1)
  const revised = historicalRows(input, { triggerAt, recheckAt })
  await db.transaction('rw', [db.events, db.issues, db.workOrders, db.records, db.notifications, db.audits], async () => {
    if (await db.audits.get(key)) throw new Error('已导入的时间轴不得再次改写')
    await expectUnchanged(input)
    for (const row of records) {
      if (JSON.stringify(await db.records.get(row.id)) !== JSON.stringify(row)) throw new Error('记录在准备过程中发生变化')
      const at = shift(row.sampleTime, 5 / 60)
      await db.records.put(toPlain({ ...row, enteredAt: at, createdAt: at, isBackfill: false, note: `${row.note}；历史测试时间轴（模拟时刻）` }))
    }
    await db.events.put(toPlain(revised.event))
    await db.issues.put(toPlain(revised.issue))
    await db.workOrders.put(toPlain(revised.order))
    for (const row of notes) {
      const evidence = event.evidences.find((item) => item.level === row.level) ?? event.evidences[0]
      const at = shift(evidence?.sampleTime ?? red.sampleTime, 5 / 60)
      await db.notifications.put(toPlain({ ...row, createdAt: at, acknowledgedAt: triggerAt }))
    }
    await db.audits.add({ ...buildAuditLog({ actor: '演示数据准备', actorRole: 'system', action: 'import', objectType: 'system', objectId: event.id, objectLabel: event.eventNo, summary: '导入新历史闭环测试案例时间轴', reason: '仅本次新案例；业务状态由原写入口逐步生成；派工→提交 8 小时，提交→验收 2 小时；均为预设演示时刻，非实际耗时。原操作日志的当前导入时间保留。' }), id: key })
  })
}

async function expectUnchanged(input: HistoryInput): Promise<void> {
  const current = { event: await db.events.get(input.event.id), issue: await db.issues.get(input.issue.id), order: await db.workOrders.get(input.order.id) }
  for (const key of ['event', 'issue', 'order'] as const) {
    if (JSON.stringify(current[key]) !== JSON.stringify(toPlain(input[key]))) throw new Error('历史案例在准备过程中发生变化，未改写')
  }
}

function historicalRows(input: HistoryInput, times: { triggerAt: string; recheckAt: string }): HistoryInput {
  const verifiedAt = shift(times.triggerAt, 12)
  return {
    order: historicalOrder(input.order, times.triggerAt),
    issue: historicalIssue(input.issue, { ...times, verifiedAt }),
    event: historicalEvent(input.event, times),
  }
}

function historicalOrder(order: WorkOrder, triggerAt: string): WorkOrder {
  const assignedAt = shift(triggerAt, 2)
  const submittedAt = shift(assignedAt, 8)
  const verifiedAt = shift(submittedAt, 2)
  const actionTimes: Record<string, string> = {
    创建工单: shift(triggerAt, 1), 派工: assignedAt, 接单处理: shift(assignedAt, 0.25),
    提交待验收: submittedAt, 验收通过: verifiedAt,
  }
  return {
    ...order, createdAt: actionTimes.创建工单 ?? triggerAt, assignedAt, submittedAt, updatedAt: verifiedAt,
    timeline: order.timeline.map((row) => ({ ...row, at: actionTimes[row.action] ?? verifiedAt, detail: `${row.detail}（历史测试时刻）` })),
    reviews: order.reviews.map((row) => ({ ...row, at: verifiedAt })),
  }
}

function historicalIssue(issue: InspectionIssue, times: { triggerAt: string; recheckAt: string; verifiedAt: string }): InspectionIssue {
  const { triggerAt, recheckAt, verifiedAt } = times
  return {
    ...issue, createdAt: shift(triggerAt, 0.5), reviewedAt: shift(triggerAt, 1), updatedAt: recheckAt,
    timeline: issue.timeline.map((row, index) => ({
      ...row,
      at: index === 0 ? shift(triggerAt, 0.5) : index === 1 ? shift(triggerAt, 1)
        : row.action.includes('确认恢复') ? recheckAt : verifiedAt,
    })),
    rechecks: (issue.rechecks ?? []).map((row) => ({ ...row, at: verifiedAt, dueDate: localDate(recheckAt), outcomeAt: recheckAt })),
  }
}

function historicalEvent(event: AlarmEvent, times: { triggerAt: string; recheckAt: string }): AlarmEvent {
  const openAt = shift(event.evidences[0]?.sampleTime ?? times.triggerAt, 5 / 60)
  const closedAt = shift(times.recheckAt, 0.25)
  return {
    ...event, openedAt: openAt, createdAt: openAt,
    acknowledgedAt: event.acknowledgedAt === null ? null : times.triggerAt,
    closedAt, updatedAt: closedAt, note: `${COVERAGE_NOTE} 已完成闭环；时间及耗时为历史预设测试值`,
    evidences: event.evidences.map((row) => ({ ...row, addedAt: shift(row.sampleTime, 5 / 60) })),
    upgrades: event.upgrades.map((row) => ({ ...row, at: shift(event.evidences.find((item) => item.recordNo === row.recordNo)?.sampleTime ?? times.triggerAt, 5 / 60) })),
    timeline: event.timeline.map((row, index) => ({ ...row, at: eventActionTime({ action: row.action, index, event, ...times, closedAt }) })).sort((a, b) => a.at.localeCompare(b.at)),
  }
}

function eventActionTime(input: { action: string; index: number; event: AlarmEvent; triggerAt: string; recheckAt: string; closedAt: string }): string {
  if (input.action.includes('关闭')) return input.closedAt
  if (input.action.includes('恢复')) return shift(input.recheckAt, -1)
  if (input.action.includes('问题')) return shift(input.triggerAt, 0.5)
  if (input.action.includes('确认')) return input.triggerAt
  const evidence = input.event.evidences[input.index]
  return evidence === undefined ? input.triggerAt : shift(evidence.sampleTime, 5 / 60)
}

function localDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

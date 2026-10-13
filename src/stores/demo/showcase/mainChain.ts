/** 模拟内容只是输入；权限、状态机、附件与关闭校验仍由原业务接口执行。 */
import { db } from '@/db/database'
import { P_CRACK } from '@/db/seedFactories'
import { CRACK_SAMPLES, demoSampleTime } from '@/config/demoScript'
import { todayInput } from '@/core/time'
import type { RunStep } from '@/core/demo/showcase/runner'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useRecordsStore } from '@/stores/records'
import { loadLiveResponseScenario } from '@/stores/writes/demo/liveResponse'
import { withActor } from '@/stores/writes/demo/support'
import { reachTarget, type OrderSpec } from '@/stores/writes/demo/workOrder'

export interface ShowcaseRefs { eventId: string; issueId: string; orderId: string }
const NOTE = '完整自动演示（模拟输入）'
const FLOW = ['created', 'assigned', 'repairing', 'submitted', 'verified']
const spec: OrderSpec = {
  tag: NOTE, pointId: P_CRACK, buildingId: 'bld_b03', floorId: 'flr_b03_02', zoneId: '二层走廊',
  anomalyType: '测点固定件松动', summary: '模拟现场检查：固定件松动，经维修和复测后恢复。', target: 'verified',
}

async function trigger(refs: ShowcaseRefs): Promise<void> {
  if (refs.eventId && await db.events.get(refs.eventId)) return
  const out = await withActor('safety', loadLiveResponseScenario)
  if (!out.ok || !out.focus?.query.event) throw new Error(out.message)
  refs.eventId = out.focus.query.event
  const event = await db.events.get(refs.eventId)
  if (event?.level !== 'red' || event.upgrades.length !== 2) throw new Error('主案例预警升级核验未通过')
}

async function acknowledge(refs: ShowcaseRefs): Promise<void> {
  await useEventsStore().reload()
  await withActor('safety', () => useEventsStore().acknowledgeEvent(refs.eventId))
  if ((await db.events.get(refs.eventId))?.acknowledgedAt === null) throw new Error('事件尚未确认')
}

async function createIssue(refs: ShowcaseRefs): Promise<void> {
  const existing = await db.issues.where('eventId').equals(refs.eventId).toArray()
  if (existing.length > 1) throw new Error('主案例关联多个问题，请检查关联')
  if (existing[0]) { refs.issueId = existing[0].id; return }
  const out = await withActor('safety', () => useIssueStore().createIssueFromEvent({
    ...spec, eventId: refs.eventId, description: `${NOTE}：${spec.summary}`, photos: [], detail: NOTE,
  }))
  refs.issueId = out.issue.id
}

async function review(refs: ShowcaseRefs): Promise<void> {
  const issues = useIssueStore()
  await issues.reload()
  const issue = issues.byId(refs.issueId)
  if (!issue) throw new Error('主案例问题不存在')
  if (issue.status === 'pending_review') {
    const result = await withActor('safety', () => issues.reviewIssue(refs.issueId, {
      action: 'to_repair', category: 'equipment', note: `${NOTE}：安排固定件维修并保留结构复测。`,
    }))
    if (!result.ok) throw new Error(result.error)
  }
  await useWorkOrderStore().reload()
  const orders = useWorkOrderStore().ordersOfIssue(refs.issueId)
  if (orders.length !== 1) throw new Error('主案例未产生唯一维修工单')
  refs.orderId = orders[0]!.id
}

async function orderTo(refs: ShowcaseRefs, target: OrderSpec['target']): Promise<void> {
  await useWorkOrderStore().reload()
  const order = useWorkOrderStore().byId(refs.orderId)
  if (!order) throw new Error('主案例工单不存在')
  if (FLOW.indexOf(order.status) >= FLOW.indexOf(target)) return
  const error = await reachTarget({ ...spec, target }, refs.orderId)
  if (error) throw new Error(error)
  if ((await db.workOrders.get(refs.orderId))?.status !== target) throw new Error('工单提交后状态核验失败')
}

async function recovery(refs: ShowcaseRefs): Promise<void> {
  if ((await db.events.get(refs.eventId))?.status === 'closed') return
  const records = useRecordsStore()
  await records.reload()
  const first = records.ofPoint(P_CRACK).find(row => row.note.startsWith('现场处置演示：第一天'))
  if (!first) throw new Error('主案例缺少起始采样，未生成恢复结论')
  for (const sample of CRACK_SAMPLES.slice(4)) {
    const time = demoSampleTime(sample, new Date(first.sampleTime))
    const existing = records.ofPoint(P_CRACK).find(row => row.sampleTime === time)
    if (existing) {
      if (!existing.note.startsWith(NOTE)) throw new Error('恢复复测时刻冲突')
      continue
    }
    await withActor('inspector', () => records.addRecord({
      pointId: P_CRACK, deviceId: null, values: sample.values, unit: 'mm', sampleTime: time,
      sampleWindow: '', source: 'manual', quality: 'valid', qualityNote: '', note: `${NOTE}：${sample.label}（历史补录）`,
    }))
  }
  await useEventsStore().reload()
  if ((await db.events.get(refs.eventId))?.status !== 'recovering') throw new Error('原规则尚未确认连续恢复')
}

async function register(refs: ShowcaseRefs): Promise<void> {
  await useIssueStore().reload()
  const issue = useIssueStore().byId(refs.issueId)
  if (issue?.rechecks?.length) return
  const out = await withActor('safety', () => useIssueStore().registerRecheck(refs.issueId, {
    subject: `${NOTE}：固定情况与连续恢复复测`, owner: '李老师（后勤保障处）', dueDate: todayInput(),
  }))
  if (!out.ok) throw new Error(out.error)
}

async function recheck(refs: ShowcaseRefs): Promise<void> {
  await useIssueStore().reload()
  const issue = useIssueStore().byId(refs.issueId)
  if (issue?.status === 'closed' && issue.rechecks?.some(row => row.outcome === 'recovered')) return
  const out = await withActor('safety', () => useIssueStore().recordRecheckOutcome(refs.issueId, {
    outcome: 'recovered', note: `${NOTE}：固定情况已复核，原规则判定连续恢复；预设演示结论。`,
  }))
  if (!out.ok) throw new Error(out.error)
}

async function close(refs: ShowcaseRefs): Promise<void> {
  await useEventsStore().reload()
  if ((await db.events.get(refs.eventId))?.status === 'closed') return
  await withActor('safety', () => useEventsStore().closeEvent(refs.eventId, {
    basis: `${NOTE}：关联设备维修工单已验收，复查已确认恢复，连续复测满足原规则。`, noRepairNote: '',
  }))
  if ((await db.events.get(refs.eventId))?.status !== 'closed') throw new Error('事件关闭后核验失败')
}

export function mainSteps(refs: ShowcaseRefs): RunStep[] {
  return [
    { id: 'trigger', run: () => trigger(refs) }, { id: 'acknowledge', run: () => acknowledge(refs) },
    { id: 'createIssue', run: () => createIssue(refs) }, { id: 'review', run: () => review(refs) },
    ...(['assigned', 'repairing', 'submitted', 'verified'] as const).map(target => ({ id: target, run: () => orderTo(refs, target) })),
    { id: 'recovery', run: () => recovery(refs) }, { id: 'register', run: () => register(refs) },
    { id: 'recheck', run: () => recheck(refs) }, { id: 'close', run: () => close(refs) },
  ]
}

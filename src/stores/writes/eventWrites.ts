/**
 * 预警事件写入：把 core/event/plan 的决策结论落到本地数据库。
 * 决策逻辑不在本文件，本文件只负责写库、写日志与刷新状态。
 */
import { nowIso } from '@/core/time'
import { uid } from '@/core/id'
import { putEvent, putNotification } from '@/db/repo'
import type { MonitorRecord } from '@/types/domain'
import type { AlarmEvent, EventEvidence, EventLevel } from '@/types/events'
import { EVENT_LEVEL_LABEL } from '@/types/events'
import type { RuleAssessment } from '@/types/rules'
import type { AssessmentSnapshot } from '@/core/rules'
import { notificationsFor, planEvent, planRevision, type EventActor, type EventPlan, type RevisionPlan } from '@/core/event/plan'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'
import { useEventsStore } from '../events'

export interface ApplyResult {
  action: 'created' | 'appended' | 'upgraded' | 'recovering' | 'none'
  eventId: string
  message: string
}

/** 把一次判定结果落到事件上。返回动作类型与提示文案，供页面反馈。 */
export async function applyAssessment(input: {
  record: MonitorRecord
  assessment: RuleAssessment
  snapshot: AssessmentSnapshot
}): Promise<ApplyResult> {
  const archive = useArchiveStore()
  const session = useSessionStore()
  const events = useEventsStore()
  const actor: EventActor = { name: session.name, role: session.roleLabel }
  const at = nowIso()
  const open = events.openEventOf(input.record.pointId, input.snapshot.ruleId)

  const plan = planEvent({
    open,
    record: input.record,
    assessment: input.assessment,
    snapshot: input.snapshot,
    actor,
    at,
  })

  if (plan.action === 'none') {
    return { action: 'none', eventId: '', message: '' }
  }

  const pointLabel = archive.pointLabel(input.record.pointId)

  if (plan.action === 'recovering' && open !== undefined) {
    await putEvent({
      ...open,
      status: 'recovering',
      updatedAt: at,
      updatedBy: actor.name,
      timeline: [
        ...open.timeline,
        {
          at,
          by: actor.name,
          action: '进入恢复待确认',
          detail: `${input.record.recordNo} 连续低于恢复阈值，只改变数据状态，不自动关闭事件`,
        },
      ],
    })
    await events.reload()
    await archive.log('update', 'record', open.id, open.eventNo, `事件 ${open.eventNo} 转为恢复待确认`, '')
    return { action: 'recovering', eventId: open.id, message: `事件 ${open.eventNo} 转为恢复待确认` }
  }

  if (plan.action === 'created' && plan.evidence !== null && plan.level !== null) {
    return createEventFromPlan({ plan, input, actor, pointLabel, at })
  }

  if (open === undefined || plan.evidence === null || plan.nextLevel === null || plan.nextPeakLevel === null) {
    return { action: 'none', eventId: '', message: '' }
  }
  return appendOrUpgrade({ plan, input, actor, open, at })
}

/** 首次越限：新建事件并按等级生成通知。 */
async function createEventFromPlan(args: {
  plan: EventPlan
  input: { record: MonitorRecord; assessment: RuleAssessment; snapshot: AssessmentSnapshot }
  actor: EventActor
  pointLabel: string
  at: string
}): Promise<ApplyResult> {
  const archive = useArchiveStore()
  const events = useEventsStore()
  const { plan, input, actor, pointLabel, at } = args
  const level = plan.level as EventLevel
  const evidence = plan.evidence as EventEvidence
  const event: AlarmEvent = {
    id: uid('evt'),
    eventNo: events.nextEventNo(input.record.sampleTime),
    pointId: input.record.pointId,
    ruleId: input.snapshot.ruleId,
    ruleCode: input.snapshot.ruleCode,
    level,
    peakLevel: level,
    status: 'pending',
    unit: input.snapshot.unit,
    openedAt: at,
    openedBy: actor.name,
    lastTriggerAt: input.record.sampleTime,
    lastTriggerValue: evidence.triggerValue,
    evidences: [evidence],
    supersededEvidences: [],
    upgrades: [],
    timeline: [
      {
        at,
        by: actor.name,
        action: `生成${EVENT_LEVEL_LABEL[level]}事件`,
        detail: `${pointLabel} 触发值 ${evidence.triggerValue} ${input.snapshot.unit}；规则 ${input.snapshot.ruleCode} ${input.snapshot.ruleVersion}`,
      },
    ],
    acknowledgedAt: null,
    acknowledgedBy: '',
    closedAt: null,
    closedBy: '',
    closeBasis: '',
    note: '',
    createdAt: at,
    createdBy: actor.name,
    updatedAt: at,
    updatedBy: actor.name,
  }
  await putEvent(event)
  for (const row of notificationsFor({ eventId: event.id, eventNo: event.eventNo, level, at })) {
    await putNotification(row)
  }
  await events.reload()
  await archive.log(
    'create',
    'record',
    event.id,
    event.eventNo,
    `生成${EVENT_LEVEL_LABEL[level]}预警事件 ${event.eventNo}`,
    `${pointLabel}；触发值 ${evidence.triggerValue} ${input.snapshot.unit}；规则 ${input.snapshot.ruleCode} ${input.snapshot.ruleVersion}`,
  )
  return { action: 'created', eventId: event.id, message: `生成${EVENT_LEVEL_LABEL[level]}事件 ${event.eventNo}` }
}

/** 事件已存在：只追加证据；等级升高时记录升级并按新等级补发通知。 */
async function appendOrUpgrade(args: {
  plan: EventPlan
  input: { record: MonitorRecord; assessment: RuleAssessment; snapshot: AssessmentSnapshot }
  actor: EventActor
  open: AlarmEvent
  at: string
}): Promise<ApplyResult> {
  const archive = useArchiveStore()
  const events = useEventsStore()
  const { plan, input, actor, open, at } = args
  const evidence = plan.evidence as EventEvidence
  const nextLevel = plan.nextLevel as EventLevel
  const raised = plan.action === 'upgraded'
  const next: AlarmEvent = {
    ...open,
    level: nextLevel,
    peakLevel: plan.nextPeakLevel as EventLevel,
    lastTriggerAt: input.record.sampleTime,
    lastTriggerValue: evidence.triggerValue,
    evidences: [...open.evidences, evidence],
    upgrades: plan.upgrade === null ? open.upgrades : [...open.upgrades, plan.upgrade],
    updatedAt: at,
    updatedBy: actor.name,
    timeline: [
      ...open.timeline,
      {
        at,
        by: actor.name,
        action: raised ? `等级升级为${EVENT_LEVEL_LABEL[nextLevel]}` : '追加证据',
        detail: raised
          ? `${input.record.recordNo} 触发值 ${evidence.triggerValue} ${input.snapshot.unit}；规则 ${input.snapshot.ruleCode} ${input.snapshot.ruleVersion}`
          : `${input.record.recordNo} 触发值 ${evidence.triggerValue} ${input.snapshot.unit}，未超过事件当前等级`,
      },
    ],
  }
  await putEvent(next)
  if (plan.notifyLevel !== null) {
    for (const row of notificationsFor({ eventId: next.id, eventNo: next.eventNo, level: plan.notifyLevel, at })) {
      await putNotification(row)
    }
  }
  await events.reload()
  await archive.log(
    'update',
    'record',
    next.id,
    next.eventNo,
    raised ? `事件 ${next.eventNo} 升级为${EVENT_LEVEL_LABEL[nextLevel]}` : `事件 ${next.eventNo} 追加证据`,
    `${input.record.recordNo}；同一点位同一规则未关闭时只追加证据，不重复建单`,
  )
  return {
    action: raised ? 'upgraded' : 'appended',
    eventId: next.id,
    message: raised
      ? `事件 ${next.eventNo} 升级为${EVENT_LEVEL_LABEL[nextLevel]}`
      : `事件 ${next.eventNo} 追加证据（当前${EVENT_LEVEL_LABEL[next.level]}）`,
  }
}

/**
 * 把修订结论写成新的事件对象：旧证据进"已替代"，等级按活跃证据汇总。
 * 纯构造，不写库，便于单独核对结果。
 */
function applyRevisedEvidence(args: {
  open: AlarmEvent
  plan: RevisionPlan
  record: MonitorRecord
  reason: string
  actor: EventActor
  at: string
}): AlarmEvent {
  const { open, plan, record, reason, actor, at } = args
  const active =
    plan.action === 'withdrawn'
      ? open.evidences.filter((item) => item.recordId !== record.id)
      : [...open.evidences.filter((item) => item.recordId !== record.id), plan.evidence as EventEvidence]
  return {
    ...open,
    level: plan.nextLevel ?? open.level,
    peakLevel: plan.nextPeakLevel ?? open.peakLevel,
    evidences: active,
    supersededEvidences: [
      ...open.supersededEvidences,
      { evidence: plan.superseded as EventEvidence, supersededAt: at, supersededBy: actor.name, reason },
    ],
    updatedAt: at,
    updatedBy: actor.name,
    timeline: [
      ...open.timeline,
      {
        at,
        by: actor.name,
        action: plan.action === 'withdrawn' ? '修订后撤销证据' : '修订后替换证据',
        detail:
          plan.action === 'withdrawn'
            ? `${record.recordNo} 修订后不再越限，原证据移入已替代证据；原因：${reason}`
            : `${record.recordNo} 修订后重新判定，事件等级重新汇总为 ${EVENT_LEVEL_LABEL[plan.nextLevel ?? open.level]}；原因：${reason}`,
      },
    ],
  }
}

/**
 * 修订一条记录后调整事件。
 * 有活跃证据时走修订路径（旧证据移入 supersededEvidences，等级按活跃证据重新汇总）；
 * 没有活跃证据时按普通判定处理，可能在修订后才首次越限。
 */
export async function applyRevision(input: {
  record: MonitorRecord
  assessment: RuleAssessment
  snapshot: AssessmentSnapshot
  reason: string
}): Promise<ApplyResult> {
  const archive = useArchiveStore()
  const session = useSessionStore()
  const events = useEventsStore()
  const actor: EventActor = { name: session.name, role: session.roleLabel }
  const at = nowIso()
  const open = events.openEventOf(input.record.pointId, input.snapshot.ruleId)
  const hasEvidence = open?.evidences.some((item) => item.recordId === input.record.id) ?? false

  if (open === undefined || !hasEvidence) {
    const created = await applyAssessment(input)
    if (created.action === 'none') return created
    return { ...created, message: `修订后${created.message}` }
  }

  const plan = planRevision({
    open,
    record: input.record,
    assessment: input.assessment,
    snapshot: input.snapshot,
    actor,
    at,
    reason: input.reason,
  })
  if (plan.action === 'none' || plan.superseded === null) {
    return { action: 'none', eventId: '', message: '' }
  }

  const next = applyRevisedEvidence({ open, plan, record: input.record, reason: input.reason, actor, at })
  await putEvent(next)
  if (plan.notifyLevel !== null) {
    for (const row of notificationsFor({ eventId: next.id, eventNo: next.eventNo, level: plan.notifyLevel, at })) {
      await putNotification(row)
    }
  }
  await events.reload()
  await archive.log(
    'revise',
    'record',
    next.id,
    next.eventNo,
    plan.action === 'withdrawn'
      ? `事件 ${next.eventNo} 在记录修订后撤销一条证据`
      : `事件 ${next.eventNo} 在记录修订后替换证据`,
    `${input.record.recordNo}；同一条记录在事件中最多保留一条活跃证据`,
  )
  return {
    action: plan.action === 'withdrawn' ? 'appended' : 'upgraded',
    eventId: next.id,
    message:
      plan.action === 'withdrawn'
        ? `事件 ${next.eventNo} 已撤销该记录的越限证据，仍在等待处置`
        : `事件 ${next.eventNo} 已按修订后的判定更新为${EVENT_LEVEL_LABEL[plan.nextLevel ?? open.level]}`,
  }
}

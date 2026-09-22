/**
 * 预警事件的纯决策逻辑：给定"当前未关闭事件 + 本次判定结果"，决定该做什么。
 *
 * 抽成纯函数是刻意的：事件去重与升级是 V0.2 最容易被质疑的一条
 * （"同一条裂缝报了三次，你是不是建了三张单？"），必须能脱离数据库直接测。
 * 写库动作由 stores/eventWrites.ts 根据这里的结论执行。
 */
import { uid } from '@/core/id'
import type { MonitorRecord } from '@/types/domain'
import type {
  AlarmEvent,
  AlarmNotification,
  EventEvidence,
  EventLevel,
  EventUpgrade,
} from '@/types/events'
import { EVENT_LEVEL_RANK, notifyPolicyOf } from '@/types/events'
import type { RuleAssessment } from '@/types/rules'
import type { AssessmentSnapshot } from '@/core/rules'

export interface EventActor {
  name: string
  role: string
}

/** 判定结果中构成"越限"的三个等级；其余状态不建事件。 */
export function levelOfState(state: RuleAssessment['state']): EventLevel | null {
  return state === 'yellow' || state === 'orange' || state === 'red' ? state : null
}

export function buildEvidence(input: {
  record: MonitorRecord
  assessment: RuleAssessment
  snapshot: AssessmentSnapshot
  actor: EventActor
  at: string
}): EventEvidence {
  return {
    recordId: input.record.id,
    recordNo: input.record.recordNo,
    sampleTime: input.record.sampleTime,
    level: (levelOfState(input.assessment.state) ?? 'yellow') as EventLevel,
    triggerValue: input.assessment.triggerValue ?? 0,
    baselineValue: input.assessment.baselineValue,
    ruleCode: input.snapshot.ruleCode,
    ruleVersion: input.snapshot.ruleVersion,
    thresholds: input.snapshot.thresholds,
    basis: input.assessment.basis,
    reason: input.assessment.reason,
    addedAt: input.at,
    addedBy: input.actor.name,
    addedByRole: input.actor.role,
  }
}

export interface EventPlan {
  action: 'created' | 'appended' | 'upgraded' | 'recovering' | 'none'
  /** 本次命中等级；不构成绩效时为 null */
  level: EventLevel | null
  evidence: EventEvidence | null
  upgrade: EventUpgrade | null
  /** 需要新生成的通知等级；只在建事件或升级时产生 */
  notifyLevel: EventLevel | null
  /** 事件在本次之后的等级与最高等级 */
  nextLevel: EventLevel | null
  nextPeakLevel: EventLevel | null
}

/**
 * 决策规则（方案 §13.1）：
 * - 同一点位、同一规则、未关闭的事件只追加证据，不重复建单；
 * - 命中等级高于事件历史最高等级时记录一次升级，等级回落不改动历史；
 * - 数据转为恢复待确认时只改事件状态，不自动关闭。
 */
export function planEvent(input: {
  open: AlarmEvent | undefined
  record: MonitorRecord
  assessment: RuleAssessment
  snapshot: AssessmentSnapshot
  actor: EventActor
  at: string
}): EventPlan {
  const level = levelOfState(input.assessment.state)
  const none: EventPlan = {
    action: 'none',
    level: null,
    evidence: null,
    upgrade: null,
    notifyLevel: null,
    nextLevel: null,
    nextPeakLevel: null,
  }

  if (level === null) {
    if (input.assessment.state !== 'recovering' || input.open === undefined) return none
    return {
      ...none,
      action: 'recovering',
      nextLevel: input.open.level,
      nextPeakLevel: input.open.peakLevel,
    }
  }

  const evidence = buildEvidence({
    record: input.record,
    assessment: input.assessment,
    snapshot: input.snapshot,
    actor: input.actor,
    at: input.at,
  })

  if (input.open === undefined) {
    return {
      action: 'created',
      level,
      evidence,
      upgrade: null,
      notifyLevel: level,
      nextLevel: level,
      nextPeakLevel: level,
    }
  }

  const raised = EVENT_LEVEL_RANK[level] > EVENT_LEVEL_RANK[input.open.peakLevel]
  const upgrade: EventUpgrade | null = raised
    ? {
        at: input.at,
        by: input.actor.name,
        byRole: input.actor.role,
        from: input.open.peakLevel,
        to: level,
        recordNo: input.record.recordNo,
        triggerValue: evidence.triggerValue,
        ruleVersion: input.snapshot.ruleVersion,
      }
    : null

  return {
    action: raised ? 'upgraded' : 'appended',
    level,
    evidence,
    upgrade,
    notifyLevel: raised ? level : null,
    nextLevel: raised ? level : input.open.level,
    nextPeakLevel: raised ? level : input.open.peakLevel,
  }
}

export interface RevisionPlan {
  action: 'replaced' | 'withdrawn' | 'appended' | 'none'
  evidence: EventEvidence | null
  /** 被本次修订替代的旧证据 */
  superseded: EventEvidence | null
  nextLevel: EventLevel | null
  nextPeakLevel: EventLevel | null
  notifyLevel: EventLevel | null
}

function rankToLevel(rank: number): EventLevel {
  if (rank >= EVENT_LEVEL_RANK.red) return 'red'
  if (rank >= EVENT_LEVEL_RANK.orange) return 'orange'
  return 'yellow'
}

/**
 * 事件等级按活跃证据重新汇总：撤销的证据不再计入。
 * 证据被修订撤销到一条不剩时保留原等级，但页面会明确提示"当前无活跃证据，等级待复核" ——
 * 事件不自动关闭，也不假装等级仍有证据支撑。
 */
function summarize(active: EventEvidence[], fallback: EventLevel): { level: EventLevel; peakLevel: EventLevel } {
  if (active.length === 0) return { level: fallback, peakLevel: fallback }
  const rank = Math.max(...active.map((item) => EVENT_LEVEL_RANK[item.level]))
  const level = rankToLevel(rank)
  return { level, peakLevel: level }
}

/**
 * 修订一条记录后如何调整事件。
 *
 * 关键约束：一条 recordId 在同一事件中最多只有一条活跃证据。
 * 修订时旧证据移入 supersededEvidences（保留审计），再按新判定决定替换或撤销；
 * 等级与最高等级都按活跃证据重新汇总，不留下"原来红色、修订后正常"两份矛盾证据。
 */
export function planRevision(input: {
  open: AlarmEvent | undefined
  record: MonitorRecord
  assessment: RuleAssessment
  snapshot: AssessmentSnapshot
  actor: EventActor
  at: string
  reason: string
}): RevisionPlan {
  const none: RevisionPlan = {
    action: 'none',
    evidence: null,
    superseded: null,
    nextLevel: null,
    nextPeakLevel: null,
    notifyLevel: null,
  }
  const open = input.open
  if (open === undefined) return none
  const previous = open.evidences.find((item) => item.recordId === input.record.id)
  if (previous === undefined) return none

  const level = levelOfState(input.assessment.state)

  if (level === null) {
    const rest = open.evidences.filter((item) => item.recordId !== input.record.id)
    const summary = summarize(rest, open.level)
    return {
      ...none,
      action: 'withdrawn',
      superseded: previous,
      nextLevel: summary.level,
      nextPeakLevel: summary.peakLevel,
    }
  }

  const evidence = buildEvidence({
    record: input.record,
    assessment: input.assessment,
    snapshot: input.snapshot,
    actor: input.actor,
    at: input.at,
  })
  const rest = open.evidences.filter((item) => item.recordId !== input.record.id)
  const summary = summarize([...rest, evidence], open.level)
  return {
    action: 'replaced',
    evidence,
    superseded: previous,
    nextLevel: summary.level,
    nextPeakLevel: summary.peakLevel,
    notifyLevel: EVENT_LEVEL_RANK[summary.level] > EVENT_LEVEL_RANK[open.level] ? summary.level : null,
  }
}

/** 关闭事件的权限与时机校验：只有安全管理人员能在恢复待确认状态关闭。 */
export const CLOSE_AUTHORIZED_ROLE = 'safety'

export interface CloseGuard {
  allowed: boolean
  reason: string
}

export function closeGuard(status: string, roleKey: string): CloseGuard {
  if (status === 'closed') return { allowed: false, reason: '事件已关闭' }
  if (roleKey !== CLOSE_AUTHORIZED_ROLE) {
    return { allowed: false, reason: '仅学校安全管理人员可关闭事件；物业、巡检与维修角色不能关闭' }
  }
  if (status !== 'recovering') {
    return { allowed: false, reason: '仅“恢复待确认”状态可关闭；请先确认事件并等待数据回落到恢复阈值以下' }
  }
  return { allowed: true, reason: '' }
}

export interface ClosePlan {
  ok: boolean
  error: string
  next: AlarmEvent | null
}

/**
 * 关闭事件的唯一业务入口：权限、时机、依据三项一起校验。
 * 界面隐藏按钮不算限制，任何调用方都必须经过本函数才能得到可写入的事件对象。
 *
 * `basisDetail` 是处置依据的明细（关联工单已验收通过 / "无需维修"核查结论原文）。
 * 它单独传、不揉进 basis：basis 是人写的复查结论，依据是客观事实，两者都留痕但不混为一谈。
 */
export function planClose(input: {
  event: AlarmEvent | undefined
  roleKey: string
  basis: string
  basisDetail?: string
  actor: EventActor
  at: string
}): ClosePlan {
  const { event } = input
  if (event === undefined) return { ok: false, error: '事件不存在', next: null }
  const guard = closeGuard(event.status, input.roleKey)
  if (!guard.allowed) return { ok: false, error: guard.reason, next: null }
  const basis = input.basis.trim()
  if (basis === '') return { ok: false, error: '关闭事件必须填写关闭依据', next: null }
  const summary = input.basisDetail === undefined || input.basisDetail.trim() === '' ? '' : `；处置依据：${input.basisDetail.trim()}`
  return {
    ok: true,
    error: '',
    next: {
      ...event,
      status: 'closed',
      closedAt: input.at,
      closedBy: input.actor.name,
      closeBasis: basis,
      updatedAt: input.at,
      updatedBy: input.actor.name,
      timeline: [
        ...event.timeline,
        {
          at: input.at,
          by: input.actor.name,
          action: '关闭事件',
          detail: `${input.actor.role}填写关闭依据：${basis}${summary}`,
        },
      ],
    },
  }
}

/** 建事件或升级时生成的通知：按等级取接收对象与演示确认时限。 */
export function notificationsFor(input: {
  eventId: string
  eventNo: string
  level: EventLevel
  at: string
}): AlarmNotification[] {
  const policy = notifyPolicyOf(input.level)
  return policy.targets.map((target) => ({
    id: uid('ntf'),
    eventId: input.eventId,
    eventNo: input.eventNo,
    level: input.level,
    target,
    channel: '站内提醒',
    createdAt: input.at,
    presentedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: '',
    dueMinutes: policy.dueMinutes,
    fallback: policy.fallback,
    escalatedAt: null,
    escalatedTo: '',
    escalationSource: '',
  }))
}

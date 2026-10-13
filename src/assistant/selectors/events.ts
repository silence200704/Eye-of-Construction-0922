/**
 * 事件选择器：未关闭队列、某测点的当前事件、证据快照。
 *
 * 证据优先取"支持当前等级的那一条"——方案要求回答"为什么是红色"时给出触发值、基准值、
 * 命中规则与版本，而不是笼统地说一句"超阈值了"。
 */
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import type { AlarmEvent, EventEvidence, EventLevel } from '@/types/events'
import { EVENT_LEVEL_RANK } from '@/types/events'
import type { PointRef } from '../resolve'
import type { AskCandidate, AskFact } from '../types'

export function openEvents(events: AlarmEvent[]): AlarmEvent[] {
  return events.filter((row) => row.status !== 'closed')
}

/** 按等级从高到低、同级按最近触发时间排序：队列的阅读顺序。 */
export function bySeverity(events: AlarmEvent[]): AlarmEvent[] {
  return [...events].sort((a, b) => {
    const rank = EVENT_LEVEL_RANK[b.level] - EVENT_LEVEL_RANK[a.level]
    return rank !== 0 ? rank : b.lastTriggerAt.localeCompare(a.lastTriggerAt)
  })
}

export function openEventsOfPoint(events: AlarmEvent[], pointId: string): AlarmEvent[] {
  return bySeverity(openEvents(events).filter((row) => row.pointId === pointId))
}

export function openEventsByLevel(events: AlarmEvent[], level: EventLevel): AlarmEvent[] {
  return bySeverity(openEvents(events).filter((row) => row.level === level))
}

/** 最近一次已关闭事件：用来回答"没有未关闭事件"时补一句"上一次是什么时候关的"。 */
export function lastClosedEventOfPoint(events: AlarmEvent[], pointId: string): AlarmEvent | null {
  const closed = events
    .filter((row) => row.pointId === pointId && row.status === 'closed')
    .sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''))
  return closed.length === 0 ? null : closed[closed.length - 1]
}

export function findEventByNo(events: AlarmEvent[], eventNo: string): AlarmEvent | null {
  const target = eventNo.trim().toUpperCase()
  return events.find((row) => row.eventNo.toUpperCase() === target) ?? null
}

/**
 * 支持当前等级的那条证据：优先等级等于事件当前等级的最近一条；
 * 没有（例如等级来自人工调整）则退回证据链最后一条，不编造。
 */
export function supportingEvidence(event: AlarmEvent): EventEvidence | null {
  if (event.evidences.length === 0) return null
  const sameLevel = event.evidences.filter((row) => row.level === event.level)
  const pool = sameLevel.length > 0 ? sameLevel : event.evidences
  return [...pool].sort((a, b) => a.sampleTime.localeCompare(b.sampleTime))[pool.length - 1]
}

/** 全部证据的编号清单，供界面逐条展开。 */
export function evidenceRefs(event: AlarmEvent): { recordId: string; recordNo: string; level: EventLevel; sampleTime: string }[] {
  return [...event.evidences]
    .sort((a, b) => a.sampleTime.localeCompare(b.sampleTime))
    .map((row) => ({ recordId: row.recordId, recordNo: row.recordNo, level: row.level, sampleTime: row.sampleTime }))
}

/** 阈值三档的中文写法；环境类规则没有数值阈值，返回空串由调用方换成说明。 */
function thresholdText(evidence: EventEvidence, unit: string): string {
  const rows = evidence.thresholds
  if (rows === null) return ''
  return `黄 ${fmtNumber(rows.yellow)} / 橙 ${fmtNumber(rows.orange)} / 红 ${fmtNumber(rows.red)}${unit}`
}

/** 证据快照转成可展示的关键数值；单位取自事件本身（证据快照里不存单位）。 */
export function evidenceFacts(evidence: EventEvidence, unit: string): AskFact[] {
  const facts: AskFact[] = [{ label: '触发值', value: fmtNumber(evidence.triggerValue), unit }]
  if (evidence.baselineValue !== null) {
    facts.push({ label: '判定基准', value: fmtNumber(evidence.baselineValue), unit })
  }
  const thresholds = thresholdText(evidence, unit)
  if (thresholds !== '') facts.push({ label: '当次阈值', value: thresholds, unit: '' })
  facts.push({ label: '判定方式', value: evidence.basis, unit: '' })
  facts.push({ label: '命中规则', value: `${evidence.ruleCode}（${evidence.ruleVersion}）`, unit: '' })
  facts.push({ label: '证据采样时间', value: formatDateTime(evidence.sampleTime), unit: '' })
  return facts
}

/** 某等级的中文名，用于结论句。 */
export function levelText(level: EventLevel): string {
  if (level === 'red') return '红色紧急核查'
  if (level === 'orange') return '橙色排查'
  return '黄色关注'
}

/** 单字等级名：升级链与队列里用短名，避免一句话里塞三个"紧急核查"。 */
function levelShort(level: EventLevel): string {
  if (level === 'red') return '红'
  if (level === 'orange') return '橙'
  return '黄'
}

/** 升级链文本：`黄 → 橙 → 红`；没有升级时就是当前等级。 */
export function upgradeChain(event: AlarmEvent): string {
  const first = event.upgrades.length > 0 ? event.upgrades[0].from : event.level
  // `from` 只是升级前的等级，重复项去掉，免得出现"红 → 红"
  const steps = event.upgrades.map((row) => levelShort(row.to)).filter((text, index, all) => index === 0 || text !== all[index - 1])
  const head = steps[0] === levelShort(first) ? [] : [levelShort(first)]
  return [...head, ...steps].join(' → ')
}

/** 多条事件命中时的候选清单（例如"当前有 3 条未关闭红色事件"）。 */
export function eventCandidates(rows: AlarmEvent[], points: PointRef[]): AskCandidate[] {
  return rows.map((row) => {
    const point = points.find((item) => item.id === row.pointId)
    return {
      id: row.id,
      label: `${row.eventNo}（${levelText(row.level)}）`,
      detail: `${point === undefined ? '测点已不在档案' : `${point.code} ${point.name}`}｜最近触发 ${formatDateTime(row.lastTriggerAt)}`,
    }
  })
}

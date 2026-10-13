/**
 * 「读数恢复了吗」的回答模板。
 *
 * 只说三件**已经落库**的事：最新有效读数、事件证据里的峰值与当次阈值、事件当前状态。
 * 刻意不做的事：不重算判定值、不套阈值判"恢复没有"、不因为读数回落去关闭事件 ——
 * "恢复待确认"是规则引擎的结论，"能不能关闭"是人在原工作台按流程做的决定。
 */
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import { metricDef, type MetricField } from '@/types/catalog'
import type { AlarmEvent, EventEvidence } from '@/types/events'
import { EVENT_LEVEL_LABEL, EVENT_STATUS_LABEL } from '@/types/events'
import type { MonitorRecord } from '@/types/domain'
import { buildLink, buildSpatialLink } from '../actions'
import { draft, type AnswerDraft } from '../answers/shared'
import type { PointRef } from '../resolve'
import type { AssistantSnapshot } from '../selectors'
import { lastClosedEventOfPoint, latestAnyRecord, latestValidRecord, openEventsOfPoint, supportingEvidence, timingOf } from '../selectors'
import { EVENT_RECOVERY_NOTE } from './notes'

export interface RecoveryAnswerInput {
  snapshot: AssistantSnapshot
  point: PointRef
  matchNote: string
}

export function answerReadingRecovery(input: RecoveryAnswerInput): AnswerDraft {
  const { snapshot, point } = input
  const reading = latestValidRecord(snapshot.records, point.id)
  const event = openEventsOfPoint(snapshot.events, point.id)[0] ?? lastClosedEventOfPoint(snapshot.events, point.id)
  const notes = [`定位口径：${input.matchNote}`, EVENT_RECOVERY_NOTE]

  if (reading === null) {
    const latestAny = latestAnyRecord(snapshot.records, point.id)
    return draft(`${point.code} ${point.name} 没有可用的有效读数，因此无法回答"恢复没有"。`, {
      status: 'not_found',
      pointId: point.id,
      facts: [
        { label: '测点', value: `${point.code} ${point.name}`, unit: '' },
        { label: '记录情况', value: latestAny === null ? '本机没有该测点的记录' : `${latestAny.recordNo}（质量标记不足以下结论）`, unit: '' },
      ],
      gaps: [
        '有没有恢复要看"最新有效读数"，现在没有有效读数，给不出这个结论。',
        '数据不足时不显示"正常"，也不把旧读数当作现在的值。',
      ],
      links: [buildLink('point_trend', point.id), buildLink('monitor')],
      dataNotes: notes,
    })
  }

  const field = metricDef(point.metric).fields[0]
  const value = field === undefined ? undefined : reading.values[field.key]
  if (event === null) {
    return noEventDraft(input, reading, value, notes)
  }

  const evidence = supportingEvidence(event)
  const readingText = value === undefined || field === undefined
    ? '本机有最新有效记录'
    : `最新有效读数 ${fmtNumber(value, field.digits)} ${field.unit}`
  const peak = field === undefined ? null : peakOf(snapshot, event, field)
  const compareText = peak === null || value === undefined || field === undefined
    ? '事件证据里的记录已不在本机，因此不给出与峰值的比较。'
    : `它比事件证据里的峰值 ${fmtNumber(peak.value, field.digits)} ${field.unit}（记录 ${peak.recordNo}，采样 ${formatDateTime(peak.sampleTime)}）` +
      `${value < peak.value ? '低' : value > peak.value ? '高' : '持平'} ${fmtNumber(Math.abs(value - peak.value), field.digits)}${field.unit}。`

  return draft(
    // 新鲜度说明自己就带"采样时间 …"：这里不再单独写一遍采样时间，免得同一句里出现两次
    `${point.code} ${point.name}：${readingText}（记录 ${reading.recordNo}，${timingOf(reading, snapshot.now).freshnessLabel}）。` +
      `${compareText}事件 ${event.eventNo}（${EVENT_LEVEL_LABEL[event.level]}）当前状态「${EVENT_STATUS_LABEL[event.status]}」。`,
    {
      pointId: point.id,
      facts: [
        { label: '测点', value: `${point.code} ${point.name}`, unit: '' },
        ...(value === undefined || field === undefined ? [] : [{ label: field.label, value: fmtNumber(value, field.digits), unit: field.unit }]),
        ...(peak === null || field === undefined ? [] : [{ label: `事件证据峰值（${field.label}）`, value: fmtNumber(peak.value, field.digits), unit: field.unit }]),
        { label: '事件状态', value: `${event.eventNo}（${EVENT_STATUS_LABEL[event.status]}）`, unit: '' },
        ...thresholdFacts(evidence, event.unit),
        ...(event.status === 'closed'
          ? [{ label: '关闭依据', value: `${event.closeBasis || '未填'}（${event.closedBy || '未知'} 于 ${formatDateTime(event.closedAt ?? '')}）`, unit: '' }]
          : []),
      ],
      timing: timingOf(reading, snapshot.now),
      evidence: [
        { kind: 'record', ref: reading.recordNo, id: reading.id, detail: '最新有效读数' },
        ...(evidence === null ? [] : [{ kind: 'record' as const, ref: evidence.recordNo, id: evidence.recordId, detail: '事件证据记录' }]),
        { kind: 'event', ref: event.eventNo, id: event.id, detail: `${EVENT_LEVEL_LABEL[event.level]}事件` },
      ],
      gaps: recoveryGaps(snapshot, point, event, value, peak),
      links: [
        buildLink('event_detail', event.id),
        buildLink('event_report', event.id),
        buildLink('point_trend', point.id),
        buildSpatialLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }),
      ],
      dataNotes: notes,
    },
  )
}

/** 没有关联事件：直说没有"恢复"这件事可判，仍然给出最新有效读数。 */
function noEventDraft(
  input: RecoveryAnswerInput,
  reading: MonitorRecord,
  value: number | undefined,
  notes: string[],
): AnswerDraft {
  const { snapshot, point } = input
  const field = metricDef(point.metric).fields[0]
  const text = value === undefined || field === undefined
    ? '本机有最新有效记录'
    : `最新有效读数 ${fmtNumber(value, field.digits)} ${field.unit}（采样 ${formatDateTime(reading.sampleTime)}）`
  return draft(`${point.code} ${point.name}：${text}。该测点没有关联的预警事件，所以没有"恢复"这件事可判。`, {
    status: 'not_found',
    pointId: point.id,
    facts: [
      { label: '测点', value: `${point.code} ${point.name}`, unit: '' },
      ...(value === undefined || field === undefined ? [] : [{ label: field.label, value: fmtNumber(value, field.digits), unit: field.unit }]),
    ],
    timing: timingOf(reading, snapshot.now),
    evidence: [{ kind: 'record', ref: reading.recordNo, id: reading.id, detail: '最新有效读数' }],
    gaps: ['没有预警事件时，"恢复"无从谈起；数据不足或没有事件都不显示"正常"。'],
    links: [buildLink('point_trend', point.id), buildLink('alarm_queue')],
    dataNotes: notes,
  })
}

interface PeakRef {
  value: number
  recordNo: string
  sampleTime: string
}

/** 事件证据里同一指标字段的最大记录值；记录不在本机就返回 null，不拿判定值顶替。 */
function peakOf(snapshot: AssistantSnapshot, event: AlarmEvent, field: MetricField): PeakRef | null {
  const rows: EventEvidence[] = [
    ...event.evidences,
    ...event.supersededEvidences.map((row) => row.evidence),
  ]
  let best: PeakRef | null = null
  for (const evidence of rows) {
    const record = snapshot.records.find((item) => item.id === evidence.recordId)
    const raw = record?.values[field.key]
    if (raw === undefined || !Number.isFinite(raw)) continue
    if (best === null || raw > best.value) {
      best = { value: raw, recordNo: evidence.recordNo, sampleTime: evidence.sampleTime }
    }
  }
  return best
}

/** 当次阈值只**引用**证据快照里记下的那一份，不重新取当前规则、也不重算判定值。 */
function thresholdFacts(evidence: EventEvidence | null, unit: string): NonNullable<AnswerDraft['facts']> {
  const rows = evidence?.thresholds
  if (evidence === null || rows === undefined || rows === null) return []
  return [
    { label: '当次判定阈值', value: `黄 ${fmtNumber(rows.yellow)} / 橙 ${fmtNumber(rows.orange)} / 红 ${fmtNumber(rows.red)}${unit}`, unit: '' },
    { label: '判定口径', value: `${evidence.basis}（规则 ${evidence.ruleCode} ${evidence.ruleVersion}）`, unit: '' },
  ]
}

function recoveryGaps(
  snapshot: AssistantSnapshot,
  point: PointRef,
  event: AlarmEvent,
  value: number | undefined,
  peak: PeakRef | null,
): string[] {
  const gaps: string[] = []
  if (peak === null) gaps.push('事件的证据记录已不在本机档案里，因此无法给出与历史峰值的比较。')
  if (value === undefined) gaps.push('该指标没有可读的数值字段，无法给出当前读数。')
  if (event.status === 'closed') {
    gaps.push('该事件已关闭：上面说明的是关闭时的结论，重新开启需要按原工作台流程新建处置。')
  } else if (event.status === 'recovering') {
    gaps.push('规则引擎已把它标为「恢复待确认」：这表示判定值满足恢复条件，**不等于**可以关闭事件。')
  } else {
    gaps.push('事件当前不是"恢复待确认"：读数回落不改变事件状态，是否恢复要由规则引擎按当时的规则版本判定。')
  }
  gaps.push('关闭事件需要由学校安全管理人员在原工作台选择关闭依据后确认；助手不改状态、也不替人提交结论。')
  if (snapshot.ruleAt(point.id, snapshot.now) === undefined) {
    gaps.push('该测点当前没有适用的启用规则，因此不会有新的自动判定结果。')
  }
  return gaps
}

/**
 * 「为什么触发红色预警 / 下一步怎么办」的回答模板。
 *
 * 证据一律引用事件里已落库的判定快照（触发值、基准值、阈值、规则与版本、采样时间），
 * 不重新判定、不调整阈值口径；来源为演示传感器数据的记录要写明它是演示链路写入的，
 * 不是已接入的设备心跳。
 */
import { formatDateTime } from '@/core/time'
import { EVENT_STATUS_LABEL } from '@/types/events'
import type { AlarmEvent } from '@/types/events'
import { buildLink, buildSpatialLink, buildSpatialTourLink } from '../actions'
import type { AssistantSnapshot } from '../selectors'
import { evidenceFacts, evidenceRefs, findPoint, issuesOfEvent, levelText, supportingEvidence, timingOf, upgradeChain } from '../selectors'
import { devicesOfPoint } from '../selectors/snapshot'
import { DEVICE_HEALTH_NOTE, draft, provenanceOf, type AnswerDraft } from './shared'

export interface EventAnswerInput {
  snapshot: AssistantSnapshot
  event: AlarmEvent
  /** 定位口径：按事件编号精确匹配 / 沿用当前上下文 */
  matchNote: string
}

export function answerEventReason(input: EventAnswerInput): AnswerDraft {
  const { snapshot, event } = input
  const evidence = supportingEvidence(event)
  const notes = [`定位口径：${input.matchNote}`, '判定依据直接引用事件里已落库的判定快照，助手不重新计算阈值。']
  const base = eventFacts(snapshot, event)
  const gaps = eventGaps(snapshot, event)

  if (evidence === null) {
    return draft(`${event.eventNo}（${levelText(event.level)}）当前没有活跃证据，无法说明触发原因。`, {
      status: 'not_found',
      pointId: event.pointId,
      facts: base,
      gaps: ['该事件的证据链为空；可能是证据被修订替代后尚未补入新证据。', ...gaps],
      links: eventLinks(snapshot, event),
      dataNotes: notes,
    })
  }

  const record = snapshot.records.find((row) => row.id === evidence.recordId) ?? null
  const point = findPoint(snapshot, event.pointId) ?? null
  const device = point === null ? null : devicesOfPoint(snapshot, point.id)[0] ?? null
  /*
   * 判定说明直接用引擎写下的 reason，不自己再算一遍。
   * 曾经在这里追加过"相对基准变化 = 触发值 − 基准值"，但裂缝这类按 |Δ| 判定的指标里
   * 触发值本身就是变化量，再减一次会得到 -0.18 mm 这种看着像结论、其实没有含义的数字。
   */
  const reason = evidence.reason
  const conclusion =
    `${event.eventNo}（${levelText(event.level)}）于 ${formatDateTime(event.openedAt)} 生成，当前状态「${EVENT_STATUS_LABEL[event.status]}」。` +
    `触发原因是${evidence.basis}：证据记录 ${evidence.recordNo} 触发值 ${evidence.triggerValue}${event.unit}` +
    `，命中规则 ${evidence.ruleCode}（${evidence.ruleVersion}）。`

  return draft(conclusion, {
    pointId: event.pointId,
    facts: [...base, ...evidenceFacts(evidence, event.unit), { label: '判定说明', value: reason, unit: '' }],
    timing: record === null ? null : timingOf(record, snapshot.now),
    provenance:
      record === null || point === null
        ? null
        : provenanceOf(record, point, device, snapshot.now),
    evidence: eventEvidence(event),
    gaps,
    links: eventLinks(snapshot, event),
    dataNotes: [
      ...notes,
      DEVICE_HEALTH_NOTE,
      '确认、转问题、派工、验收、关闭都在原工作台按角色权限完成，助手只做只读导航，不代替提交。',
      ...deviceSourceNotes(snapshot, event),
    ],
  })
}

/** 事件自身的状态与时间轴要点。 */
function eventFacts(snapshot: AssistantSnapshot, event: AlarmEvent): NonNullable<AnswerDraft['facts']> {
  const point = findPoint(snapshot, event.pointId)
  const rows: NonNullable<AnswerDraft['facts']> = [
    { label: '事件编号', value: event.eventNo, unit: '' },
    { label: '当前等级', value: levelText(event.level), unit: '' },
    { label: '历史最高等级', value: levelText(event.peakLevel), unit: '' },
    { label: '当前状态', value: EVENT_STATUS_LABEL[event.status], unit: '' },
    { label: '涉及测点', value: point === undefined ? '测点已不在档案里' : `${point.code} ${point.name}`, unit: '' },
    { label: '升级过程', value: upgradeChain(event), unit: '' },
    { label: '最近触发时间', value: formatDateTime(event.lastTriggerAt), unit: '' },
    { label: '证据条数', value: `${event.evidences.length} 条（另有 ${event.supersededEvidences.length} 条被修订替代）`, unit: '' },
  ]
  rows.push({
    label: '确认情况',
    value: event.acknowledgedAt === null ? '尚未确认' : `${event.acknowledgedBy} 于 ${formatDateTime(event.acknowledgedAt)} 确认`,
    unit: '',
  })
  if (event.status === 'closed') {
    rows.push({ label: '关闭依据', value: `${event.closeBasis || '未填'}（${event.closedBy || '未知'} 于 ${formatDateTime(event.closedAt ?? '')}）`, unit: '' })
  }
  return rows
}

/** 事件边界说明：已关闭、有被替代证据、升级过，都要说清楚。 */
function eventGaps(snapshot: AssistantSnapshot, event: AlarmEvent): string[] {
  const gaps: string[] = []
  if (event.supersededEvidences.length > 0) {
    gaps.push(`有 ${event.supersededEvidences.length} 条证据已被修订替代，仍保留在事件里供审计，不计入当前等级。`)
  }
  if (event.upgrades.length > 0) {
    gaps.push(`该事件经历过 ${event.upgrades.length} 次升级：${upgradeChain(event)}。`)
  }
  if (event.status === 'closed') {
    gaps.push('该事件已关闭，本回答说明的是当时的判定依据；如需重开，请按原工作台流程新建处置。')
  }
  const point = findPoint(snapshot, event.pointId)
  if (point === undefined) gaps.push('该事件的测点已不在当前档案里，位置与档案信息无法补齐。')
  else if (point.archived) gaps.push('该测点已归档，读数不再更新。')
  const issues = issuesOfEvent(snapshot, event.id)
  gaps.push(
    issues.length === 0
      ? '该事件还没有关联问题；转问题与派工需要在学校安全管理身份下、在原工作台完成。'
      : `该事件已关联 ${issues.length} 个问题，可在问题与工单页查看审核、派工与复查状态。`,
  )
  return gaps
}

function eventEvidence(event: AlarmEvent): NonNullable<AnswerDraft['evidence']> {
  const rows = evidenceRefs(event).map((row) => ({
    kind: 'record' as const,
    ref: row.recordNo,
    id: row.recordId,
    detail: `证据记录（${levelText(row.level)}）采样 ${formatDateTime(row.sampleTime)}`,
  }))
  return [{ kind: 'event', ref: event.eventNo, id: event.id, detail: '预警事件本体' }, ...rows]
}

function eventLinks(snapshot: AssistantSnapshot, event: AlarmEvent): AnswerDraft['links'] {
  const links = [buildLink('event_detail', event.id), buildLink('event_report', event.id), buildLink('alarm_queue')]
  const point = findPoint(snapshot, event.pointId)
  if (point !== undefined) {
    links.push(buildLink('point_building', point.buildingId))
    // "这条预警在哪一层"：按真实事件的测点定位到 3D 的楼栋/楼层/标记，颜色取自事件等级
    links.push(buildSpatialLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }))
    links.push(buildSpatialTourLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }, event.id))
  }
  for (const issue of issuesOfEvent(snapshot, event.id)) {
    links.push(buildLink('issue_detail', issue.id))
    if (issue.workOrderIds.length > 0) links.push(buildLink('workorder_detail', issue.workOrderIds[0]))
  }
  return links
}

/** 触发记录来自模拟传感器时必须点明，不能读成已接入的设备心跳。 */
function deviceSourceNotes(snapshot: AssistantSnapshot, event: AlarmEvent): string[] {
  const evidence = supportingEvidence(event)
  if (evidence === null) return []
  const record = snapshot.records.find((row) => row.id === evidence.recordId)
  if (record === undefined || record.source !== 'device') return []
  return ['触发记录来源标记为「传感器数据（演示）」：它是演示链路写入的预设数据，不是已接入的设备心跳或真实设备实时上送；采样与录入时间以证据记录为准。']
}

/**
 * 「列出还没处理的预警」的回答模板。
 *
 * 队列按等级从高到低、同级按最近触发时间排；计数按事件 ID 去重 ——
 * 一次升级只改同一条事件，不会把"升过级的事件"数成两条。
 */
import { formatDateTime } from '@/core/time'
import { EVENT_STATUS_LABEL } from '@/types/events'
import { buildLink } from '../actions'
import type { AssistantSnapshot } from '../selectors'
import { bySeverity, findPoint, levelText, openEvents, supportingEvidence } from '../selectors'
import { draft, type AnswerDraft } from './shared'

/** 一行一条事件，半屏里再长就没人看了；超出的让用户去预警中心按等级筛。 */
export const QUEUE_LIMIT = 8

export function answerOpenEvents(snapshot: AssistantSnapshot): AnswerDraft {
  const rows = bySeverity(openEvents(snapshot.events))
  const counts = { red: 0, orange: 0, yellow: 0 }
  for (const row of rows) counts[row.level] += 1
  const conclusion =
    rows.length === 0
      ? '当前没有任何未关闭的预警事件。'
      : `当前有 ${rows.length} 条未关闭预警：红 ${counts.red}｜橙 ${counts.orange}｜黄 ${counts.yellow}。`

  const facts: NonNullable<AnswerDraft['facts']> = [
    { label: '未关闭合计', value: String(rows.length), unit: '条' },
    { label: '红色', value: String(counts.red), unit: '条' },
    { label: '橙色', value: String(counts.orange), unit: '条' },
    { label: '黄色', value: String(counts.yellow), unit: '条' },
  ]
  for (const row of rows.slice(0, QUEUE_LIMIT)) {
    const point = findPoint(snapshot, row.pointId)
    facts.push({
      label: `${row.eventNo}（${levelText(row.level)}｜${EVENT_STATUS_LABEL[row.status]}）`,
      value: `${point === undefined ? '测点已不在档案' : `${point.code} ${point.name}`}｜最近触发 ${formatDateTime(row.lastTriggerAt)}`,
      unit: '',
    })
  }

  return draft(conclusion, {
    facts,
    evidence: queueEvidence(snapshot, rows.slice(0, QUEUE_LIMIT).map((row) => row.id)),
    gaps: queueGaps(rows.length),
    links: [buildLink('alarm_queue'), buildLink('reports'), buildLink('campus_map')],
    dataNotes: [
      '计数按事件 ID 去重：升级只改同一条事件，不新增记录，因此不会重复计数。',
      '队列只列未关闭事件；已关闭事件可在预警中心按状态筛选查看。',
    ],
  })
}

function queueEvidence(snapshot: AssistantSnapshot, eventIds: string[]): NonNullable<AnswerDraft['evidence']> {
  const rows: NonNullable<AnswerDraft['evidence']> = []
  for (const id of eventIds) {
    const event = snapshot.events.find((row) => row.id === id)
    if (event === undefined) continue
    rows.push({ kind: 'event', ref: event.eventNo, id: event.id, detail: `${levelText(event.level)}｜${EVENT_STATUS_LABEL[event.status]}` })
    const evidence = supportingEvidence(event)
    if (evidence !== null) {
      rows.push({ kind: 'record', ref: evidence.recordNo, id: evidence.recordId, detail: `支撑 ${event.eventNo} 当前等级的证据记录` })
    }
  }
  return rows
}

function queueGaps(total: number): string[] {
  const gaps: string[] = []
  if (total === 0) gaps.push('未关闭为 0 只表示当前没有待处置事件，不代表系统做过巡检或已排除风险。')
  if (total > QUEUE_LIMIT) {
    gaps.push(`这里只列出前 ${QUEUE_LIMIT} 条（按等级和最近触发时间排序），其余 ${total - QUEUE_LIMIT} 条请在预警中心按等级筛选查看。`)
  }
  gaps.push('每条事件的处置入口在原工作台，按其角色权限完成；助手只做只读导航。')
  return gaps
}

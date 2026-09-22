/**
 * 预警触发提醒的纯构造逻辑。
 *
 * 这里只识别“新建事件 / 等级升级”两种值得打扰操作者的结果；同一事件追加证据、
 * 恢复待确认和无事件都不会伪装成一条新预警。实际的站内通知仍由 event/plan 生成。
 */
import { EVENT_LEVEL_LABEL, EVENT_LEVEL_RANK, notifyPolicyOf, type AlarmEvent, type EventLevel } from '@/types/events'
import type { RecordSource } from '@/types/domain'

export type AlertTriggerAction = 'created' | 'appended' | 'upgraded' | 'recovering' | 'none'

export interface AlertPromptEventInput {
  event: Pick<AlarmEvent, 'id' | 'eventNo' | 'level' | 'lastTriggerValue' | 'unit'>
  action: AlertTriggerAction
  pointLabel: string
}

export interface AlertPrompt {
  key: string
  kind: 'event' | 'batch'
  level: EventLevel
  strong: boolean
  title: string
  detail: string
  eventId: string | null
  eventNo: string | null
  targetText: string
}

/** 当前手工输入或设备上报才即时打扰操作者；历史补录、CSV 与演示脚本只走汇总或页面结果。 */
export function shouldPresentManualAlert(input: { source: RecordSource; isBackfill: boolean }): boolean {
  return (input.source === 'manual' || input.source === 'device') && !input.isBackfill
}

/** 同一事件同一次等级变化只提醒一次；升级到更高等级仍应产生一条新的提醒。 */
export function alertKey(input: AlertPromptEventInput): string {
  return `${input.event.id}:${input.action}:${input.event.level}`
}

/** 只把真正新建或升级的事件交给提醒层。 */
export function eventAlertPrompt(input: AlertPromptEventInput): AlertPrompt | null {
  if (input.action !== 'created' && input.action !== 'upgraded') return null
  const { event } = input
  const policy = notifyPolicyOf(event.level)
  const prefix = input.action === 'created' ? '已生成' : '已升级为'
  return {
    key: alertKey(input),
    kind: 'event',
    level: event.level,
    strong: event.level === 'red',
    title: `${EVENT_LEVEL_LABEL[event.level]}预警${prefix}`,
    detail: `${event.eventNo}｜${input.pointLabel}｜最近触发值 ${event.lastTriggerValue} ${event.unit}`,
    eventId: event.id,
    eventNo: event.eventNo,
    targetText: `已按现有策略生成通知：${policy.targets.join('、')}`,
  }
}

/**
 * 批量导入只给一条汇总提醒，避免一份文件连续弹出多次打断现场操作。
 * 同一事件在本批次先生成又升级时只算一个事件，并按最终最高等级汇总。
 */
export function batchAlertPrompt(inputs: AlertPromptEventInput[]): AlertPrompt | null {
  const prompts = inputs
    .map(eventAlertPrompt)
    .filter((row): row is AlertPrompt => row !== null)
  if (prompts.length === 0) return null

  const unique = new Map<string, AlertPrompt>()
  for (const prompt of prompts) {
    const previous = unique.get(prompt.eventId ?? '')
    if (previous === undefined || EVENT_LEVEL_RANK[prompt.level] > EVENT_LEVEL_RANK[previous.level]) {
      unique.set(prompt.eventId ?? '', prompt)
    }
  }
  const rows = [...unique.values()]
  const highest = rows.reduce((current, row) =>
    EVENT_LEVEL_RANK[row.level] > EVENT_LEVEL_RANK[current.level] ? row : current,
  )
  const count = rows.length
  return {
    key: `batch:${rows.map((row) => row.key).sort().join('|')}`,
    kind: 'batch',
    level: highest.level,
    strong: false,
    title: `批量导入发现 ${count} 个预警事件`,
    detail: `本批次新建或升级 ${count} 个事件，最高为${EVENT_LEVEL_LABEL[highest.level]}。未逐条弹窗，避免中断导入。`,
    eventId: null,
    eventNo: null,
    targetText: '请到预警中心核对事件、证据链和已生成的站内通知。',
  }
}

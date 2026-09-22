/**
 * 预警事件与通知。
 *
 * 事件是"数据判定"到"人的处置"之间的桥梁：保存有效数据后由规则判定自动生成或升级，
 * 同一测点同一条规则在未关闭前只保留一条事件，新证据追加进来，升级过程完整留痕。
 *
 * 判定快照（规则编号、版本、阈值、触发值、基准值、判定依据）随每条证据一起写入，
 * 因此后来调整阈值不会改变历史事件的解释。
 */
import type { AuditFields } from './domain'
import type { RuleThresholds } from './rules'

export type EventLevel = 'yellow' | 'orange' | 'red'

/**
 * 事件状态。方案要求检查完成、问题解决、工单验收分别追踪，
 * 因此事件状态与记录的数据状态分开表达。
 */
export type EventStatus = 'pending' | 'handling' | 'recovering' | 'closed'

/** 一条证据 = 一次触发判定的完整快照，用于回答"为什么当时是橙色"。 */
export interface EventEvidence {
  recordId: string
  recordNo: string
  sampleTime: string
  level: EventLevel
  triggerValue: number
  baselineValue: number | null
  ruleCode: string
  ruleVersion: string
  thresholds: RuleThresholds | null
  basis: string
  reason: string
  addedAt: string
  addedBy: string
  addedByRole: string
}

/**
 * 被修订替代的证据：从证据链移出但保留，用于审计。
 * 一条 recordId 在同一事件中最多只有一条活跃证据，避免"原来红色、修订后正常"两份矛盾证据并存。
 */
export interface SupersededEvidence {
  evidence: EventEvidence
  supersededAt: string
  supersededBy: string
  reason: string
}

export interface EventUpgrade {
  at: string
  by: string
  byRole: string
  from: EventLevel
  to: EventLevel
  recordNo: string
  triggerValue: number
  ruleVersion: string
}

export interface EventTimelineItem {
  at: string
  by: string
  action: string
  detail: string
}

export interface AlarmEvent extends AuditFields {
  id: string
  eventNo: string
  pointId: string
  /** 规则稳定标识：同一规则的不同版本共用，用于事件归并 */
  ruleId: string
  ruleCode: string
  /** 当前等级 */
  level: EventLevel
  /** 历史最高等级，用于展示升级过程 */
  peakLevel: EventLevel
  status: EventStatus
  unit: string
  openedAt: string
  openedBy: string
  /** 最近一次触发时间，用于排序与督办 */
  lastTriggerAt: string
  lastTriggerValue: number
  /** 活跃证据：当前支持事件等级的记录 */
  evidences: EventEvidence[]
  /** 被修订替代的证据，保留审计 */
  supersededEvidences: SupersededEvidence[]
  upgrades: EventUpgrade[]
  timeline: EventTimelineItem[]
  acknowledgedAt: string | null
  acknowledgedBy: string
  closedAt: string | null
  closedBy: string
  closeBasis: string
  note: string
}

/**
 * 站内通知。方案要求把"已生成、已展示、已确认"分状态记录，
 * 未接入真实渠道时不得写短信或推送送达。
 */
export interface AlarmNotification {
  id: string
  eventId: string
  eventNo: string
  level: EventLevel
  /** 接收对象（演示按角色） */
  target: string
  channel: string
  createdAt: string
  /** 页面已展示时间；未接入真实渠道，不写送达 */
  presentedAt: string | null
  acknowledgedAt: string | null
  acknowledgedBy: string
  /** 演示确认时限（分钟） */
  dueMinutes: number
  /** 未确认时的替补或升级对象 */
  fallback: string
  escalatedAt: string | null
  escalatedTo: string
  /** 升级来源：'' 表示按演示时限真实超时；'demo' 表示演示模式模拟，非真实超时 */
  escalationSource: '' | 'demo'
}

export const EVENT_LEVEL_LABEL: Record<EventLevel, string> = {
  yellow: '黄色关注',
  orange: '橙色排查',
  red: '红色紧急核查',
}

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  pending: '待确认',
  handling: '处理中',
  recovering: '恢复待确认',
  closed: '已关闭',
}

/** 等级高低比较：数值越大越严重。 */
export const EVENT_LEVEL_RANK: Record<EventLevel, number> = { yellow: 1, orange: 2, red: 3 }

/** 演示通知策略：确认时限与未确认时的去向，与方案 §13.4 一致。 */
export interface NotifyPolicy {
  level: EventLevel
  targets: string[]
  dueMinutes: number
  fallback: string
}

export const NOTIFY_POLICY: NotifyPolicy[] = [
  { level: 'yellow', targets: ['点位责任人', '物业值班人员'], dueMinutes: 30, fallback: '替补人员' },
  { level: 'orange', targets: ['物业值班人员', '后勤主管'], dueMinutes: 10, fallback: '学校安全管理人员' },
  { level: 'red', targets: ['值班人员', '后勤主管', '安全管理人员'], dueMinutes: 5, fallback: '应急联系人' },
]

export function notifyPolicyOf(level: EventLevel): NotifyPolicy {
  const found = NOTIFY_POLICY.find((row) => row.level === level)
  if (found === undefined) throw new Error(`未知预警等级：${level}`)
  return found
}

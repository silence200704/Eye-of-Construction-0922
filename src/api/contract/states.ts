/**
 * V2-1 契约冻结 · 状态与迁移。
 *
 * 三条纪律：
 * 1. 状态枚举复用 `@/types/*` 的字典，**不在这里复制一份** —— 复制就会出现"契约说 A、界面说 B"；
 * 2. 能引用现有纯函数的直接引用（问题审核出口取 `nextStatusOf`，与界面预览同一份映射）；
 * 3. 核心里是私有常量的（工单状态机、复查结论映射）在这里声明一份，并由
 *    `tests/api/contract.test.ts` **驱动真实状态机逐条比对**，防止两份表漂移。
 */
import { nextStatusOf } from '@/core/inspection/issueMerge'
import { EVENT_STATUS_LABEL, EVENT_LEVEL_LABEL } from '@/types/events'
import { MAINTENANCE_STATUSES } from '@/types/maintenance'
import { ISSUE_STATUSES, RECHECK_OUTCOMES, TASK_STATUSES, WORK_ORDER_STATUSES } from '@/types/inspection'
import type { EventStatus } from '@/types/events'
import type { IssueStatus, RecheckOutcome, WorkOrderStatus } from '@/types/inspection'

export { nextStatusOf }

/** 工单状态机：与 `core/inspection/workOrderFlow.ts` 的 NEXT_STATUSES 一致。 */
export const WORK_ORDER_NEXT: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  created: ['assigned'],
  assigned: ['repairing'],
  repairing: ['submitted'],
  submitted: ['verified', 'returned'],
  verified: [],
  returned: ['repairing'],
}

/**
 * 事件状态流转。事件不接收任意写入：确认走 `acknowledgeEvent`，
 * 恢复由判定引擎按连续恢复复测给出，关闭走 `closeGuard`。这里只表达方向与终点。
 */
export const EVENT_NEXT: Record<EventStatus, EventStatus[]> = {
  pending: ['handling'],
  handling: ['recovering'],
  recovering: ['closed'],
  closed: [],
}

/** 复查结论 → 问题状态：与 `core/inspection/recheck.ts` 的 OUTCOME_STATUS 一致。 */
export const RECHECK_OUTCOME_STATUS: Record<RecheckOutcome, IssueStatus> = {
  recovered: 'closed',
  observing: 'observing',
  recurred: 'pending_review',
}

export interface StatusDef {
  key: string
  name: string
}

/** 每个资源的状态字典（界面与服务端共用同一份中文名）。 */
export const STATUS_DICTS = {
  maintenance: MAINTENANCE_STATUSES,
  issue: ISSUE_STATUSES,
  workOrder: WORK_ORDER_STATUSES,
  task: TASK_STATUSES,
  event: Object.entries(EVENT_STATUS_LABEL).map(([key, name]) => ({ key, name })),
  recheckOutcome: RECHECK_OUTCOMES,
  eventLevel: Object.entries(EVENT_LEVEL_LABEL).map(([key, name]) => ({ key, name })),
} as const

export type StatusResource = keyof typeof STATUS_DICTS

/** 状态中文名；未登记的状态原样返回，便于在日志里暴露而不是显示空白。 */
export function statusLabelOf(resource: StatusResource, key: string): string {
  const found = (STATUS_DICTS[resource] as readonly StatusDef[]).find((row) => row.key === key)
  return found === undefined ? key : found.name
}

/** 该迁移是否被状态机允许（工单与事件两张表；其余资源由 core 各自的函数判定）。 */
export function transitionAllowed(resource: 'workOrder' | 'event', from: string, to: string): boolean {
  const table = resource === 'workOrder' ? WORK_ORDER_NEXT : EVENT_NEXT
  const allowed = (table as Record<string, string[] | undefined>)[from]
  return allowed === undefined ? false : allowed.includes(to)
}

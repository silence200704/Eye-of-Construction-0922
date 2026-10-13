/**
 * V2-1 契约冻结 · 请求信封、响应信封与幂等键。
 *
 * 每个写请求都带三样东西，服务端据此判权限、判版本、判重放：
 * - `actor`：操作身份（演示里由顶栏切换，V2 起是登录账号）；
 * - `scope`：账号可见的楼栋范围（演示口径是全校，`null`）；
 * - `meta`：幂等键、期望版本、请求时刻、说明。
 *
 * 幂等键的派生规则（冻结）：`<动作>|<业务键…>`。业务键必须来自**对象自身的稳定字段**，
 * 不能带随机数或当前时间，否则重试会变成新的一次写入。各动作的键构成见 `IDEMPOTENCY_RULES`。
 */
import { errorOf } from './errors'
import type { ApiError } from './errors'
import type { WriteAction } from './scope'

export interface ActorRef {
  /** 操作人姓名（演示身份里的 name；V2 起为账号显示名） */
  name: string
  /** 角色键：safety / property / device / inspector / repair / reviewer */
  role: string
}

/** 楼栋范围：`null` = 全校（演示口径）；数组 = 仅这些楼栋。 */
export interface ScopeRef {
  buildingIds: string[] | null
}

export interface RequestMeta {
  idempotencyKey: string
  /** 期望的对象版本；null 表示"新建"或"不校验版本"（仅限新建） */
  expectedRev: number | null
  /** 请求时刻（ISO 串）；业务时间仍以对象自身字段为准，不能用它替代采样时间 */
  at: string
  note: string
}

export interface ApiOk<T> {
  ok: true
  data: T
  /** 写入后的对象版本；新建时为 1 */
  rev: number | null
  /** 幂等命中：本次没有再写一次，`data` 是既有对象 */
  replayed: boolean
}

export interface ApiFail {
  ok: false
  error: ApiError
}

export type ApiResult<T> = ApiOk<T> | ApiFail

export function ok<T>(data: T, rev: number | null = null, replayed = false): ApiOk<T> {
  return { ok: true, data, rev, replayed }
}

export function fail(error: ApiError): ApiFail {
  return { ok: false, error }
}

export function failWith(code: Parameters<typeof errorOf>[0], details: Parameters<typeof errorOf>[1] = {}): ApiFail {
  return { ok: false, error: errorOf(code, details) }
}

export function isOk<T>(result: ApiResult<T>): result is ApiOk<T> {
  return result.ok
}

/** 幂等键派生表：键构成 + 为什么这样取（服务端不得自行改口径）。 */
export interface IdempotencyRule {
  action: WriteAction
  /** 参与键的业务字段名，按顺序拼接 */
  parts: string[]
  note: string
}

export const IDEMPOTENCY_RULES: IdempotencyRule[] = [
  { action: 'archive_write', parts: ['kind', 'code'], note: '同一类档案同一编号只应有一条；编辑按编号幂等' },
  { action: 'record_write', parts: ['pointId', 'sampleTime', 'metric'], note: '同测点同采样时刻同指标只应有一条记录' },
  { action: 'record_revise', parts: ['recordId', 'revision'], note: '修订按"第几版"幂等，同一版重放只写一次' },
  { action: 'issue_report', parts: ['pointId', 'anomalyType', 'submitter', 'dayKey'], note: '与现有 submissionKey 同一口径' },
  { action: 'issue_from_event', parts: ['eventId'], note: '一条事件只转出一次问题' },
  { action: 'issue_review', parts: ['issueId', 'reviewedAt'], note: '同一问题的同一次审核只写一次' },
  { action: 'issue_recheck_register', parts: ['issueId', 'round'], note: '复查按轮次幂等，重复点击不新增轮次' },
  { action: 'issue_recheck_outcome', parts: ['issueId', 'round'], note: '同一轮结论只写一次' },
  { action: 'work_order_dispatch', parts: ['orderId', 'assignee', 'assignedAt'], note: '派工按人+时刻幂等' },
  { action: 'work_order_accept', parts: ['orderId', 'acceptedAt'], note: '接单按时刻幂等；双击只接一次' },
  { action: 'work_order_submit', parts: ['orderId', 'submittedAt'], note: '提交待验收按时刻幂等' },
  { action: 'work_order_verify', parts: ['orderId', 'reviewedAt'], note: '验收通过与退回都按时刻幂等' },
  { action: 'event_acknowledge', parts: ['eventId'], note: '事件确认对同一事件只生效一次' },
  { action: 'event_close', parts: ['eventId'], note: '事件关闭对同一事件只生效一次' },
  { action: 'inspection_checkin', parts: ['taskId', 'pointId', 'at'], note: '到点尝试每次都留痕，按时刻幂等' },
  { action: 'inspection_complete', parts: ['taskId', 'pointId', 'at'], note: '同一点位同一次完成只写一次，重放返回同一条结果' },
  { action: 'maintenance_generate', parts: ['planId', 'dayKey'], note: '同一计划同一执行时刻只有一条任务（业务键主键）' },
  { action: 'maintenance_execute', parts: ['taskId'], note: '一个周期只执行一次' },
  { action: 'attachment_upload', parts: ['draftId'], note: '与现有 draftId 同一口径：补传认草稿，不重复入库' },
]

export function idempotencyRuleOf(action: WriteAction): IdempotencyRule | undefined {
  return IDEMPOTENCY_RULES.find((row) => row.action === action)
}

/** 拼幂等键；参与拼接的部分做去空白与竖线替换，避免业务值把分隔符吃掉。 */
export function idempotencyKeyOf(action: WriteAction, parts: string[]): string {
  const clean = parts.map((part) => part.trim().replace(/\|/g, '/'))
  return [action, ...clean].join('|')
}

/** 楼栋范围校验：`null` 表示全校，任何楼栋都通过；对象没有楼栋（如系统对象）时只受角色限制。 */
export function scopeAllowsBuilding(scope: ScopeRef, buildingId: string | null): boolean {
  if (scope.buildingIds === null) return true
  if (buildingId === null) return true
  return scope.buildingIds.includes(buildingId)
}

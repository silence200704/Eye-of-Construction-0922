/**
 * V2-1 契约冻结 · 写请求校验（身份 / 越权 / 范围 / 状态 / 版本 / 幂等键 / 必填）。
 *
 * 这里写的是**服务端必须做的校验**；本地适配层用同一个函数先跑一遍，
 * 因此"前端显示与服务端写入口同一口径"是不靠自觉的 —— 两边调的是这一个函数。
 * 契约测试在没有服务端的情况下证明的是**规则本身自洽**，不证明服务端已接通。
 *
 * 校验顺序刻意固定：身份 → 幂等键 → 角色 → 楼栋范围 → 对象存在 → 服务端字段 →
 * 状态迁移 → 版本 → 人对人约束 → 必填。先判"你是谁"再判"这一步能不能做"，
 * 越权者不会因为字段没填对而先收到字段错误、从而探测出对象是否存在。
 */
import { roleName } from '@/types/catalog'
import { errorOf } from './errors'
import { scopeAllowsBuilding } from './envelope'
import { SERVER_OWNED_FIELDS } from './resources'
import { ACTION_RULES, roleAllowed } from './scope'
import { transitionAllowed } from './states'
import type { ApiError } from './errors'
import type { ActorRef, RequestMeta, ScopeRef } from './envelope'
import type { WriteAction } from './scope'

export interface WriteTarget {
  exists: boolean
  buildingId: string | null
  /** 工单/事件的状态；其余资源传 null */
  status: string | null
  /** 服务端版本；对象不存在时为 null */
  rev: number | null
  /** 人对人约束：被派工人 / 计划负责人（姓名或角色名，与现有口径一致） */
  assignedTo: string | null
  /** 角色约束：任务快照的执行角色 */
  requiredRole: string | null
  /** 有状态迁移表的资源；其余为 null（迁移由 core 各自函数判定） */
  machine: 'workOrder' | 'event' | null
}

export interface WriteRequest {
  action: WriteAction
  actor: ActorRef
  scope: ScopeRef
  meta: RequestMeta
  target: WriteTarget
  payload: Record<string, unknown>
}

export type GuardOutcome = { ok: true; error: null } | { ok: false; error: ApiError }

const ALLOW: GuardOutcome = { ok: true, error: null }

function deny(error: ApiError): GuardOutcome {
  return { ok: false, error }
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

function has(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null
}

/** 第一步 身份：姓名与角色键都要在。 */
export function checkIdentity(actor: ActorRef): GuardOutcome {
  if (actor.name.trim() === '' || actor.role.trim() === '') {
    return deny(errorOf('AUTH_REQUIRED', { field: 'actor' }))
  }
  return ALLOW
}

/** 第二步 幂等键：写请求必须能判重放，缺了就不接受（否则重试会变成第二次写入）。 */
export function checkIdempotencyKey(meta: RequestMeta): GuardOutcome {
  if (meta.idempotencyKey.trim() === '') {
    return deny(errorOf('VALIDATION_FAILED', { field: 'idempotencyKey' }))
  }
  return ALLOW
}

/** 第三步 角色。 */
export function checkRole(action: WriteAction, actor: ActorRef): GuardOutcome {
  if (!roleAllowed(action, actor.role)) {
    const roles = ACTION_RULES[action].roles
    return deny(errorOf('ROLE_FORBIDDEN', { allowedRoles: roles === '*' ? '*' : roles.join('、'), role: actor.role }))
  }
  return ALLOW
}

/** 第四步 楼栋范围。 */
export function checkScope(scope: ScopeRef, buildingId: string | null): GuardOutcome {
  if (!scopeAllowsBuilding(scope, buildingId)) {
    return deny(errorOf('SCOPE_FORBIDDEN', { buildingId, allowedBuildings: scope.buildingIds === null ? '*' : scope.buildingIds.join('、') }))
  }
  return ALLOW
}

/** 第五步 对象存在。 */
export function checkTarget(target: WriteTarget): GuardOutcome {
  return target.exists ? ALLOW : deny(errorOf('NOT_FOUND', { field: 'target' }))
}

/** 第六步 请求体不能自带服务端维护的字段（编号、状态、创建/更新痕迹）。 */
export function checkImmutable(payload: Record<string, unknown>): GuardOutcome {
  for (const field of SERVER_OWNED_FIELDS) {
    if (field in payload) return deny(errorOf('IMMUTABLE_FIELD', { field }))
  }
  return ALLOW
}

/** 第七步 状态迁移（工单与事件有表；其余资源由 core 的函数判定，不在这里假装能判）。 */
export function checkTransition(target: WriteTarget, payload: Record<string, unknown>): GuardOutcome {
  const to = str(payload, 'to')
  if (target.machine === null || to === '' || target.status === null) return ALLOW
  if (transitionAllowed(target.machine, target.status, to)) return ALLOW
  return deny(errorOf('STATE_CONFLICT', { from: target.status, to, machine: target.machine }))
}

/** 第八步 版本冲突（乐观锁）。`expectedRev` 为 null 只在新建时允许。 */
export function checkVersion(meta: RequestMeta, target: WriteTarget): GuardOutcome {
  if (meta.expectedRev === null || target.rev === null) return ALLOW
  if (meta.expectedRev === target.rev) return ALLOW
  return deny(errorOf('VERSION_CONFLICT', { expectedRev: meta.expectedRev, currentRev: target.rev }))
}

/* ------------------------------ 第九步 人对人约束 ------------------------------ */

/** 本来人是否为操作者：角色名或姓名任一匹配（与 workOrderFlow.isAssignedTo 同一口径）。 */
function isThePerson(actor: ActorRef, person: string): boolean {
  return person !== '' && (person === actor.name || person === roleName(actor.role))
}

/** 物业值班可代做，但必须写明代做原因，否则"谁去的现场、原责任人是谁"事后查不出来。 */
function substituteAllowed(actor: ActorRef, payload: Record<string, unknown>, field: string): GuardOutcome {
  if (actor.role !== 'property') return deny(errorOf('ROLE_FORBIDDEN', { reason: '非本人执行需物业值班代做', role: actor.role }))
  if (str(payload, field) === '') return deny(errorOf('VALIDATION_FAILED', { field, reason: '代人执行必须写明代做原因' }))
  return ALLOW
}

export function checkAssignment(action: WriteAction, request: Pick<WriteRequest, 'actor' | 'target' | 'payload'>): GuardOutcome {
  const { actor, target, payload } = request
  if (action === 'work_order_accept' && !isThePerson(actor, target.assignedTo ?? '')) {
    return substituteAllowed(actor, payload, 'note')
  }
  if (action === 'maintenance_execute' && !isThePerson(actor, target.assignedTo ?? '')) {
    return substituteAllowed(actor, payload, 'note')
  }
  if ((action === 'inspection_checkin' || action === 'inspection_complete') && target.requiredRole !== null) {
    if (actor.role !== target.requiredRole) {
      return deny(errorOf('ROLE_FORBIDDEN', { reason: '任务执行角色不符', requiredRole: target.requiredRole, role: actor.role }))
    }
  }
  return ALLOW
}

/* ------------------------------ 第十步 必填 ------------------------------ */

interface RequiredRule {
  field: string
  /** 该字段在什么条件下必填；缺省表示恒必填 */
  when?: (payload: Record<string, unknown>) => boolean
}

const REQUIRED: Partial<Record<WriteAction, RequiredRule[]>> = {
  record_write: [{ field: 'pointId' }, { field: 'sampleTime' }, { field: 'metric' }],
  record_revise: [{ field: 'recordId' }, { field: 'reason' }],
  event_close: [{ field: 'basis' }],
  issue_report: [{ field: 'buildingId' }, { field: 'anomalyType' }, { field: 'description' }],
  issue_from_event: [{ field: 'eventId' }],
  issue_review: [{ field: 'action' }, { field: 'category' }],
  issue_recheck_register: [{ field: 'subject' }, { field: 'owner' }, { field: 'dueDate' }],
  issue_recheck_outcome: [
    { field: 'outcome' },
    { field: 'nextDueDate', when: (payload) => str(payload, 'outcome') === 'observing' },
  ],
  work_order_dispatch: [{ field: 'assignee' }],
  work_order_submit: [{ field: 'measures' }],
  work_order_verify: [{ field: 'note', when: (payload) => str(payload, 'to') === 'returned' }],
  inspection_checkin: [{ field: 'pointId' }],
  inspection_complete: [{ field: 'pointId' }],
  maintenance_execute: [{ field: 'taskId' }],
  attachment_upload: [{ field: 'draftId' }, { field: 'ownerId' }],
}

export function checkRequired(action: WriteAction, payload: Record<string, unknown>): GuardOutcome {
  const rules = REQUIRED[action] ?? []
  for (const rule of rules) {
    if (rule.when !== undefined && !rule.when(payload)) continue
    if (!has(payload, rule.field)) {
      return deny(errorOf('VALIDATION_FAILED', { field: rule.field, action }))
    }
  }
  return ALLOW
}

/** 附件归属唯一：问题 / 工单 / 保养任务三者必须有且只有一个。 */
export function checkAttachmentOwner(action: WriteAction, payload: Record<string, unknown>): GuardOutcome {
  if (action !== 'attachment_upload') return ALLOW
  const owners = ['issueId', 'workOrderId', 'maintenanceTaskId'].filter((key) => has(payload, key))
  const ownerType = str(payload, 'ownerType')
  if (owners.length !== 1 || ownerType === '') {
    return deny(errorOf('VALIDATION_FAILED', { field: 'ownerId', reason: '附件必须有且只有一个归属' }))
  }
  return ALLOW
}

/** 一次写完：按固定顺序跑完所有校验，第一个不过就返回（不继续探测后面的条件）。 */
export function evaluateWrite(request: WriteRequest): GuardOutcome {
  const { action, actor, scope, meta, target, payload } = request
  const steps: GuardOutcome[] = [
    checkIdentity(actor),
    checkIdempotencyKey(meta),
    checkRole(action, actor),
    checkScope(scope, target.buildingId),
    checkTarget(target),
    checkImmutable(payload),
    checkTransition(target, payload),
    checkVersion(meta, target),
    checkAssignment(action, { actor, target, payload }),
    checkRequired(action, payload),
    checkAttachmentOwner(action, payload),
  ]
  return steps.find((step) => !step.ok) ?? ALLOW
}

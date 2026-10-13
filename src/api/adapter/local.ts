/**
 * V2-1 请求适配层的**本地实现**（样例）。
 *
 * 定位：**不替换现有业务路径**。页面照旧直接调 store；适配层是并行的第二条通道，
 * 用来验证"契约能覆盖真实业务"：`submit()` 先跑契约校验（与未来服务端同一个 `evaluateWrite`），
 * 再**委派现有受控入口**写库。将来把 `dispatch` 换成 `POST /api/v1/...`，调用方不用改。
 *
 * 三处必须如实标注的本地近似：
 * 1. `revOf()`：本地版本号由对象自身的**追加式历史长度**派生，服务端要用单调递增列替换；
 * 2. 幂等重放表在内存里，刷新即失；服务端用唯一索引 + 幂等键持久化；
 * 3. 留痕取当前演示身份（`useSessionStore`），因此请求里的 actor 必须与当前身份一致，
 *    否则返回 `AUTH_REQUIRED`，而不是假装写成了别人的名字。
 */
import { db } from '@/db/database'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useSessionStore } from '@/stores/session'
import type { WorkOrderStatus } from '@/types/inspection'
import { errorOf } from '../contract/errors'
import type { ApiError } from '../contract/errors'
import type { ErrorCode } from '../contract/errors.types'
import { evaluateWrite } from '../contract/guard'
import type { WriteRequest } from '../contract/guard'
import { fail, ok } from '../contract/envelope'
import { ACTION_RULES } from '../contract/scope'
import type { WriteAction } from '../contract/scope'
import type { ApiResult } from '../contract/envelope'

/** 可写的对象类型：适配层只认这几种，其余动作明确返回"未接线"。 */
export type WiredAction =
  | 'work_order_dispatch'
  | 'work_order_accept'
  | 'work_order_submit'
  | 'work_order_verify'
  | 'event_acknowledge'
  | 'event_close'
  | 'issue_report'

export const WIRED_ACTIONS: WiredAction[] = [
  'work_order_dispatch',
  'work_order_accept',
  'work_order_submit',
  'work_order_verify',
  'event_acknowledge',
  'event_close',
  'issue_report',
]

export function isWired(action: WriteAction): action is WiredAction {
  return (WIRED_ACTIONS as string[]).includes(action)
}

export interface WriteReceipt {
  id: string
  rev: number
}

const REPLAY = new Map<string, WriteReceipt>()

/** 清空内存重放表（测试与"清库重载"时用）。 */
export function resetReplayTable(): void {
  REPLAY.clear()
}

/**
 * 本地版本号近似：由追加式历史长度派生。
 * 服务端实现换成单调递增列（每次写入 +1），语义一致但不需要"读完再算"。
 */
export async function revOf(action: WriteAction, id: string): Promise<number> {
  if (action.startsWith('work_order')) {
    const row = await db.workOrders.get(id)
    return row === undefined ? 0 : row.timeline.length + row.reviews.length
  }
  if (action.startsWith('event_')) {
    const row = await db.events.get(id)
    return row === undefined ? 0 : row.timeline.length + row.evidences.length
  }
  const row = await db.issues.get(id)
  return row === undefined ? 0 : row.timeline.length + (row.rechecks?.length ?? 0)
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 过渡期错误映射：现有 store 抛的是中文句子，没有错误码。
 * 服务端上线后由服务端直接给 code，**这张表随之删除**（见交付文档的未决条件）。
 */
export function codeOfStoreMessage(message: string): ErrorCode {
  if (/无权|仅由|由学校|执行|代接|代执行/.test(message)) return 'ROLE_FORBIDDEN'
  if (/不存在|已删除/.test(message)) return 'NOT_FOUND'
  if (/必须|请填写|不能为空|至少/.test(message)) return 'VALIDATION_FAILED'
  return 'STATE_CONFLICT'
}

function storeFailure(cause: unknown): ApiError {
  const message = cause instanceof Error ? cause.message : String(cause)
  return errorOf(codeOfStoreMessage(message), { storeMessage: message })
}

/** 本地留痕取当前演示身份；请求身份与它不一致时不写，避免把动作记到别人名下。 */
function sessionMismatch(actor: { name: string; role: string }): ApiError | null {
  const session = useSessionStore()
  if (session.name !== actor.name || session.role !== actor.role) {
    return errorOf('AUTH_REQUIRED', { reason: '本地演示：留痕取当前演示身份，请先在顶栏切换为请求中的身份', session: `${session.name}/${session.role}` })
  }
  return null
}

/** 七个已接线动作的分派：每个都直接调用现有受控入口，不复制业务判定。 */
async function dispatch(request: WriteRequest): Promise<ApiResult<WriteReceipt>> {
  const { action, payload, meta } = request
  const mismatch = sessionMismatch(request.actor)
  if (mismatch !== null) return fail(mismatch)
  try {
    if (action === 'event_acknowledge') {
      const id = str(payload, 'eventId')
      await useEventsStore().acknowledgeEvent(id)
      return ok({ id, rev: await revOf(action, id) })
    }
    if (action === 'event_close') {
      const id = str(payload, 'eventId')
      await useEventsStore().closeEvent(id, { basis: str(payload, 'basis'), noRepairNote: str(payload, 'basisDetail') })
      return ok({ id, rev: await revOf(action, id) })
    }
    if (action === 'issue_report') {
      const created = await useIssueStore().reportManualIssue({
        pointId: str(payload, 'pointId') === '' ? null : str(payload, 'pointId'),
        buildingId: str(payload, 'buildingId'),
        floorId: str(payload, 'floorId'),
        zoneId: str(payload, 'zoneId'),
        anomalyType: str(payload, 'anomalyType'),
        description: str(payload, 'description'),
        photos: [],
        photoDrafts: [],
        detail: str(payload, 'detail'),
      })
      const id = created.issue?.id ?? ''
      return ok({ id, rev: await revOf(action, id) }, null, created.duplicated)
    }
    const id = str(payload, 'orderId')
    const to = str(payload, 'to') as WorkOrderStatus
    const orders = useWorkOrderStore()
    const result = await orders.advanceOrder(id, to, {
      note: str(payload, 'note'),
      assignee: str(payload, 'assignee'),
      dueAt: str(payload, 'dueAt') === '' ? null : str(payload, 'dueAt'),
      measures: str(payload, 'measures'),
      materials: str(payload, 'materials'),
      acceptancePhotos: [],
    })
    if (!result.ok) return fail(errorOf('STATE_CONFLICT', { storeMessage: result.error }))
    void meta
    return ok({ id, rev: await revOf(action, id) })
  } catch (cause) {
    return fail(storeFailure(cause))
  }
}

/**
 * 本地提交：先校验（越权 / 版本 / 状态 / 幂等键 / 必填），再判重放，最后委派写库。
 * 重放命中**不写第二次**，直接返回既有对象并置 `replayed: true`。
 */
export async function submitLocal(request: WriteRequest): Promise<ApiResult<WriteReceipt>> {
  const guard = evaluateWrite(request)
  if (!guard.ok) return fail(guard.error)
  const replayed = REPLAY.get(request.meta.idempotencyKey)
  if (replayed !== undefined) return ok(replayed, replayed.rev, true)
  if (!isWired(request.action)) {
    return fail(errorOf('NOT_DEPLOYED', { action: request.action, entry: ACTION_RULES[request.action].entry }))
  }
  const result = await dispatch(request)
  if (result.ok) {
    const receipt: WriteReceipt = { id: result.data.id, rev: result.data.rev }
    REPLAY.set(request.meta.idempotencyKey, receipt)
    return ok(receipt, receipt.rev, result.replayed)
  }
  return result
}

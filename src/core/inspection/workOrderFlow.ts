/**
 * 维修工单流转与"事件关闭前的处置依据"（纯函数）。
 *
 * 方案 §3 的两条硬约束：
 * - 工单验收 ≠ 关联问题自动关闭：验收只把问题推进到待复查，关闭要安全管理人员另行动作；
 * - 检查任务完成 ≠ 问题解决。
 * 评审补充：预警事件关闭要有处置依据 —— 关联工单验收通过，或安全管理人员填写"无需维修"的现场核查结论；
 * 两种情况都仍须满足连续 3 条恢复复测。
 */
import type { CloseBasisCheck, InspectionIssue, WorkOrder, WorkOrderReview, WorkOrderStatus } from '@/types/inspection'
import { roleName } from '@/types/catalog'

/** 可以接单与提交完工的角色：维修人员与物业值班（现场实际执行方）。 */
const REPAIR_ROLES = new Set(['repair', 'property'])

/** 验收通过与验收退回的授权角色：学校安全管理人员。 */
const VERIFY_ROLE = 'safety'

/** 工单状态机：只允许沿固定路径前进，退回会回到处理中。 */
const NEXT_STATUSES: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  created: ['assigned'],
  assigned: ['repairing'],
  repairing: ['submitted'],
  submitted: ['verified', 'returned'],
  verified: [],
  returned: ['repairing'],
}

export interface FlowInput {
  order: WorkOrder
  to: WorkOrderStatus
  at: string
  by: string
  /** 角色键（safety / repair / property …），权限判定看它；时间线里记的是它的中文名 */
  byRole: string
  note: string
}

export interface FlowOutcome {
  ok: boolean
  error: string
  next: WorkOrder | null
}

/**
 * 工单流转：派工、接单、处理中、提交待验收、验收通过、验收退回。
 *
 * 权限一律在这里拦（界面隐藏按钮不算限制）：派工与验收限学校安全管理人员，
 * 接单与提交完工限维修侧。任何调用方都要经过本函数才能拿到可写入的工单对象。
 */
export function advance(input: FlowInput): FlowOutcome {
  const order = input.order
  const allowed = NEXT_STATUSES[order.status]
  if (!allowed.includes(input.to)) {
    return deny(`工单当前为「${order.status}」，不能直接转为「${input.to}」`)
  }
  if (input.to === 'assigned' && input.byRole !== 'safety') {
    return deny('派工由学校安全管理人员执行')
  }
  // 派工必须指定维修人：不指定人的"已派工"到了现场没人接，等于没派
  if (input.to === 'assigned' && order.assignee.trim() === '') {
    return deny('派工必须指定维修人')
  }
  // 验收是授权动作：验收通过与退回都只由安全管理人员执行
  if ((input.to === 'verified' || input.to === 'returned') && input.byRole !== VERIFY_ROLE) {
    return deny('验收通过与验收退回由学校安全管理人员执行')
  }
  if (input.to === 'repairing' || input.to === 'submitted') {
    if (!REPAIR_ROLES.has(input.byRole)) {
      return deny('接单与提交完工由维修人员（或物业值班）执行')
    }
    if (order.assignee === '') {
      return deny('工单尚未指定维修人，先派工再处理')
    }
  }
  /*
   * 接单人应当就是被派工的人。演示身份只到"角色"这一层，派工时记的是角色名，
   * 因此按角色名或姓名任一匹配即视为本人；物业值班可以代接，但必须写明代接原因，
   * 否则"谁去的现场、原维修人是谁"事后查不出来。
   */
  if (input.to === 'repairing' && !isAssignedTo(order, { roleKey: input.byRole, name: input.by })) {
    if (input.byRole !== 'property') {
      return deny(`本工单已派给「${order.assignee}」，请由被派工人接单`)
    }
    if (input.note.trim() === '') {
      return deny(`物业值班代接「${order.assignee}」的工单必须写明代接原因`)
    }
  }
  if (input.to === 'submitted' && order.measures.trim() === '') {
    return deny('提交待验收必须填写维修措施，否则验收方没有依据')
  }
  if (input.to === 'returned' && input.note.trim() === '') {
    return deny('验收退回必须写明退回原因')
  }

  const review: WorkOrderReview | null =
    input.to === 'verified' || input.to === 'returned'
      ? {
          at: input.at,
          by: input.by,
          byRole: roleName(input.byRole),
          action: input.to === 'verified' ? 'verify' : 'return',
          result: input.to === 'verified' ? 'pass' : 'fail',
          note: input.note,
        }
      : null

  return {
    ok: true,
    error: '',
    next: {
      ...order,
      status: input.to,
      updatedAt: input.at,
      updatedBy: input.by,
      submittedAt: input.to === 'submitted' ? input.at : order.submittedAt,
      reviews: review === null ? order.reviews : [...order.reviews, review],
      timeline: [
        ...order.timeline,
        {
          at: input.at,
          by: input.by,
          byRole: roleName(input.byRole),
          action: STATUS_ACTION[input.to],
          detail: input.note,
        },
      ],
    },
  }
}

function deny(error: string): FlowOutcome {
  return { ok: false, error, next: null }
}

/** 是否为被派工的人：角色名或姓名任一匹配。页面提示与仓储判定共用这一处口径。 */
export function isAssignedTo(order: WorkOrder, actor: { roleKey: string; name: string }): boolean {
  if (order.assignee === '') return false
  return order.assignee === roleName(actor.roleKey) || order.assignee === actor.name
}

const STATUS_ACTION: Record<WorkOrderStatus, string> = {
  created: '创建工单',
  assigned: '派工',
  repairing: '接单处理',
  submitted: '提交待验收',
  verified: '验收通过',
  returned: '验收退回',
}

/**
 * 验收通过后的问题行：状态推进到"待复查"并追加时间线，**不自动关闭**（方案 §3）。
 *
 * 做成"返回新行"而不是"就地改一下状态"，是因为工单与问题必须在同一个事务里提交 ——
 * 调用方要先拿到完整的下一版问题行，才能和工单一起写进去（见 `commitVerifyWithIssue`）。
 * 已待复查或已关闭的问题原样返回，不重复追加节点。
 */
export function issueAfterVerify(
  issue: InspectionIssue,
  input: { orderNo: string; at: string; by: string; byRole: string },
): InspectionIssue {
  if (issue.status === 'pending_recheck' || issue.status === 'closed') return issue
  return {
    ...issue,
    status: 'pending_recheck',
    updatedAt: input.at,
    updatedBy: input.by,
    timeline: [
      ...issue.timeline,
      {
        at: input.at,
        by: input.by,
        byRole: input.byRole,
        action: '进入待复查',
        detail: `工单 ${input.orderNo} 验收通过；事件关闭还需要连续 3 条恢复复测与处置依据`,
      },
    ],
  }
}

/**
 * 事件关闭的处置依据判定。
 * 依据来自：**当前事件关联**且已验收通过的工单，或安全管理人员填写的"无需维修"现场核查结论。
 * 只有调用方没有事件标识时才按测点查询；关闭真实预警事件时始终带事件 ID，不能借用同测点旧事件的工单。
 */
export function closeBasis(input: {
  orders: WorkOrder[]
  eventId: string | null
  pointId: string | null
  noRepairNote: string
}): CloseBasisCheck {
  const related = input.orders.filter((order) =>
    input.eventId !== null ? order.eventId === input.eventId : input.pointId !== null && order.pointId === input.pointId,
  )
  const verified = related.filter((order) => order.status === 'verified')
  if (verified.length > 0) {
    return {
      ok: true,
      kind: 'work_order',
      reason: `关联工单 ${verified.map((order) => order.orderNo).join('、')} 已验收通过`,
    }
  }
  const note = input.noRepairNote.trim()
  if (note.length >= 10) {
    return { ok: true, kind: 'no_repair', reason: '已填写现场核查结论（无需维修）' }
  }
  const pending = related.filter((order) => order.status !== 'verified')
  if (pending.length > 0) {
    return {
      ok: false,
      kind: 'none',
      reason: `关联工单尚未验收通过（${pending.map((order) => `${order.orderNo} ${order.status}`).join('、')}）`,
    }
  }
  return {
    ok: false,
    kind: 'none',
    reason: '缺少处置依据：需要有验收通过的关联工单，或由安全管理人员填写现场核查结论（无需维修）',
  }
}

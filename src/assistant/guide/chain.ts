/**
 * 事件链路的**只读关联与双向 ID 校验**（纯函数）。
 *
 * 关联口径：`eventId → issue.eventId → workOrder.issueId`，再加上反向登记
 * （`issue.workOrderIds` 与 `workOrder.eventId`）交叉核对。任一处对不上都记进 `gaps`，
 * 由 `stage.ts` 决定"只显示链路待人工核对，不给正常阶段"。
 *
 * 拆成独立文件的原因：这里是"读取层"（读什么、怎么核对），`stage.ts` 是"计划层"
 * （当前走到哪一步、下一步谁做什么）。两层混在一个文件里会同时越过 450 行上限。
 */
import type { AlarmEvent } from '@/types/events'
import { buildLink } from '../actions'
import type { AssistantSnapshot } from '../selectors'
import type { IssueRef, WorkOrderRef } from '../selectors/snapshot'
import type { AskLink } from '../types'

export interface EventChain {
  event: AlarmEvent | null
  issues: IssueRef[]
  orders: WorkOrderRef[]
  /** 断链原因（双向校验）：非空时一律只显示"链路待人工核对"，不给正常阶段 */
  gaps: string[]
  /**
   * 归属**未能直接核实**的说明（不是断链）：工单自己没有登记事件号，
   * 只能靠"问题登记了它 + 它归属该问题"这条间接链核实。逐条如实报出，
   * 界面用「归属说明」单独展示，不混进断链的 `gaps`。
   */
  weak: string[]
}

/** 需要人选定时的候选项；按钮只带白名单深链，不替人打开。 */
export interface StageCandidate {
  id: string
  label: string
  detail: string
  link: AskLink
}

const ISSUE_LABEL: Record<string, string> = {
  pending_review: '待审核',
  investigating: '排查中',
  repairing: '处理中',
  pending_recheck: '待复查',
  observing: '观察中',
  closed: '已关闭',
}

function unique(rows: string[]): string[] {
  return [...new Set(rows)]
}

/**
 * 建立只读关联并做双向校验。五类对不上都会留下原因：
 * ① 问题登记的工单 ID 在工单表里不存在；
 * ② 问题登记的工单存在，但那张工单的 `issueId` 指向别的问题；
 * ③ 工单归属本事件下的问题，但问题没有反向登记这张工单（反向缺失）；
 * ④ 工单登记的事件与当前事件不一致（事件 ID 冲突）；
 * ⑤ 工单指向本事件，但它关联的问题不在本事件名下（挂到了别处）。
 */
export function associateEventChain(snapshot: AssistantSnapshot, eventId: string): EventChain {
  const event = snapshot.events.find((row) => row.id === eventId) ?? null
  if (event === null) {
    return { event: null, issues: [], orders: [], gaps: ['上一轮选定的事件已不在当前数据集。'], weak: [] }
  }
  const issues = snapshot.issues.filter((row) => row.eventId === eventId)
  const issueIds = new Set(issues.map((row) => row.id))
  const byOrderId = new Map(snapshot.workOrders.map((row) => [row.id, row]))
  const orders = ordersOf(issues, snapshot)
  return {
    event,
    issues,
    orders,
    gaps: unique(collectGaps({ snapshot, event, eventId, issues, issueIds, byOrderId })),
    weak: unique(weakLinks(orders, eventId, issues)),
  }
}

/**
 * 归属未能直接核实的工单：`eventId` 为空，只能经"问题登记 + 工单归属该问题"间接核实。
 * 这与"事件号对不上"是两回事：对不上是断链（进 `gaps`），未登记是**核实强度更弱**（进 `weak`）。
 */
function weakLinks(orders: WorkOrderRef[], eventId: string, issues: IssueRef[]): string[] {
  const out: string[] = []
  for (const order of orders) {
    if (order.eventId === eventId) continue
    const owner = issues.find((row) => row.id === order.issueId)
    out.push(
      `工单 ${order.orderNo} 没有直接登记事件号，归属按问题 ${owner?.issueNo ?? order.issueId} 的登记关系核实（未直接核实）。`,
    )
  }
  return out
}

/** 本事件下问题名下的工单（正向）。 */
function ordersOf(issues: IssueRef[], snapshot: AssistantSnapshot): WorkOrderRef[] {
  const issueIds = new Set(issues.map((row) => row.id))
  return snapshot.workOrders.filter((row) => row.issueId !== null && issueIds.has(row.issueId))
}

interface GapInput {
  snapshot: AssistantSnapshot
  event: AlarmEvent
  eventId: string
  issues: IssueRef[]
  issueIds: Set<string>
  byOrderId: Map<string, WorkOrderRef>
}

function collectGaps(input: GapInput): string[] {
  return [
    ...forwardGaps(input),
    ...reverseGaps(input.snapshot, input.event, input.eventId, input.issues),
  ]
}

/** 正向：问题登记的每张工单都要存在、且真的归属这个问题、事件一致。 */
function forwardGaps(input: GapInput): string[] {
  const out: string[] = []
  for (const issue of input.issues) {
    for (const orderId of issue.workOrderIds) {
      const order = input.byOrderId.get(orderId)
      if (order === undefined) {
        out.push(`问题 ${issue.issueNo} 登记了工单 ${orderId}，但当前数据集里没有这张工单。`)
        continue
      }
      if (order.issueId !== issue.id) {
        out.push(`问题 ${issue.issueNo} 登记了工单 ${order.orderNo}，但该工单实际归属别的问题。`)
      }
      if (order.eventId !== null && order.eventId !== input.eventId) {
        out.push(`工单 ${order.orderNo} 登记的事件与 ${input.event.eventNo} 不一致。`)
      }
    }
  }
  return out
}

/** 反向：工单要能被问题认领，且不能挂到别的事件或别的问题名下。 */
function reverseGaps(snapshot: AssistantSnapshot, event: AlarmEvent, eventId: string, issues: IssueRef[]): string[] {
  const out: string[] = []
  const issueIds = new Set(issues.map((row) => row.id))
  for (const order of snapshot.workOrders) {
    const owner = order.issueId === null ? undefined : issues.find((row) => row.id === order.issueId)
    const owned = order.issueId !== null && issueIds.has(order.issueId)
    if (owned && owner !== undefined && !owner.workOrderIds.includes(order.id)) {
      out.push(`工单 ${order.orderNo} 归属问题 ${owner.issueNo}，但该问题没有反向登记这张工单。`)
    }
    if (owned && order.eventId !== null && order.eventId !== eventId) {
      out.push(`工单 ${order.orderNo} 登记的事件与 ${event.eventNo} 不一致（两端对不上）。`)
    }
    if (order.eventId === eventId && !owned) {
      out.push(`工单 ${order.orderNo} 指向本事件，但它关联的问题不在 ${event.eventNo} 名下。`)
    }
  }
  return out
}

export function issueCandidate(issue: IssueRef): StageCandidate {
  return {
    id: issue.id,
    label: `${issue.issueNo}（${ISSUE_LABEL[issue.status] ?? issue.status}）`,
    detail: `打开问题 ${issue.issueNo} 的原业务详情`,
    link: buildLink('issue_detail', issue.id),
  }
}

export function orderCandidate(order: WorkOrderRef): StageCandidate {
  return {
    id: order.id,
    label: `${order.orderNo}（${order.status}）`,
    detail: `打开工单 ${order.orderNo} 所属问题的详情`,
    link: buildLink('workorder_detail', order.id),
  }
}

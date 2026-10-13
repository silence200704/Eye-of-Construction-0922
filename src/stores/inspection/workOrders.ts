/**
 * 维修工单仓储。
 *
 * 状态流转一律走 core 的 advance()：不允许页面直接改状态；
 * 事件关闭的处置依据由 closeBasis() 判定（验收通过的关联工单，或"无需维修"现场核查结论）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AuditLog } from '@/types/domain'
import type { InspectionIssue, IssueAttachment, WorkOrder, WorkOrderStatus } from '@/types/inspection'
import { advance, closeBasis, issueAfterVerify } from '@/core/inspection/workOrderFlow'
import { uid } from '@/core/id'
import { nowIso } from '@/core/time'
import { buildAuditLog } from '@/db/repo'
import { commitVerifyWithIssue, commitWorkOrderWrite } from '@/db/inspection/disposal'
import { buildDraftPhoto, type DraftPhotoInput } from '@/db/inspection/attachments'
import { db } from '@/db/database'
import { useAttachmentStore } from './attachments'
import { useSessionStore } from '../session'

/** 一次流转可以附带的字段：派工带人、接单带期限、完工带措施与照片 */
export interface OrderAction {
  note?: string
  assignee?: string
  dueAt?: string | null
  measures?: string
  materials?: string
  photos?: string[]
  /** 安全管理人员在验收时选取的本地压缩照片；与验收结论同事务提交。 */
  acceptancePhotos?: DraftPhotoInput[]
}

export interface OrderResult {
  ok: boolean
  error: string
  order: WorkOrder | null
}

export const useWorkOrderStore = defineStore('inspectionWorkOrders', () => {
  const orders = ref<WorkOrder[]>([])
  const loaded = ref(false)

  const openOrders = computed(() => orders.value.filter((row) => row.status !== 'verified'))

  async function reload(): Promise<void> {
    orders.value = await db.workOrders.toArray()
    loaded.value = true
  }

  function byId(id: string): WorkOrder | undefined {
    return orders.value.find((row) => row.id === id)
  }

  const ordersOfIssue = (issueId: string): WorkOrder[] => orders.value.filter((row) => row.issueId === issueId)
  const ordersOfPoint = (pointId: string): WorkOrder[] => orders.value.filter((row) => row.pointId === pointId)

  /**
   * 审核转维修时**构造**"待派工"工单（不写库）。
   *
   * 单号留空：它必须在写事务内分配，否则两条并发转维修会算出同一个号
   * （工单主键是随机 ID，数据库不会拦重复编号）。分配与写入都在
   * `commitIssueWithWorkOrder` 里完成。
   */
  function buildForIssue(input: {
    issue: InspectionIssue
    actor: string
    actorRole: string
    title: string
    eventId: string | null
  }): WorkOrder {
    const at = nowIso()
    return {
      id: uid('wo'),
      orderNo: '',
      origin: input.issue.source === 'sensor' ? 'event' : 'issue',
      issueId: input.issue.id,
      eventId: input.eventId,
      pointId: input.issue.pointId,
      title: input.title,
      status: 'created',
      assignee: '',
      assignedBy: '',
      assignedAt: null,
      dueAt: null,
      measures: '',
      materials: '',
      photos: [],
      submittedAt: null,
      reviews: [],
      timeline: [
        {
          at,
          by: input.actor,
          byRole: input.actorRole,
          action: '创建工单',
          detail: `由问题 ${input.issue.issueNo} 审核转维修生成，待派工`,
        },
      ],
      createdAt: at,
      createdBy: input.actor,
      updatedAt: at,
      updatedBy: input.actor,
    }
  }

  /** 工单流转：判定在 core 的 advance() 里，写库与日志同事务。 */
  async function advanceOrder(orderId: string, to: WorkOrderStatus, payload: OrderAction): Promise<OrderResult> {
    const order = await db.workOrders.get(orderId)
    if (order === undefined) return { ok: false, error: '工单不存在', order: null }
    const session = useSessionStore()
    const at = nowIso()
    /*
     * 先把这次提交要改的字段并进候选状态，再交给 core 判定。
     * 反过来的话，core 会拿库里那份旧数据校验（例如"提交待验收必须有维修措施"），
     * 而措施恰恰是这一次才填的，于是永远过不去。
     */
    const candidate: WorkOrder = {
      ...order,
      assignee: payload.assignee ?? order.assignee,
      assignedBy: payload.assignee === undefined ? order.assignedBy : session.name,
      assignedAt: payload.assignee === undefined ? order.assignedAt : at,
      dueAt: payload.dueAt === undefined ? order.dueAt : payload.dueAt,
      measures: payload.measures ?? order.measures,
      materials: payload.materials ?? order.materials,
      photos: payload.photos === undefined ? order.photos : [...new Set([...order.photos, ...payload.photos])],
    }

    const acceptanceAttachments = isAcceptanceAction(to)
      ? buildAcceptancePhotos(order.id, payload.acceptancePhotos, session.name)
      : []
    const actionNote = withAcceptancePhotoCount(payload.note ?? '', acceptanceAttachments.length)
    const out = advance({
      order: candidate,
      to,
      at,
      by: session.name,
      byRole: session.role,
      note: actionNote,
    })
    if (!out.ok || out.next === null) return { ok: false, error: out.error, order: null }
    const next = out.next
    const action = next.timeline[next.timeline.length - 1]?.action ?? to
    const actor = { name: session.name, roleLabel: session.roleLabel }

    if (to === 'verified') {
      const done = await commitVerify(next, actor, actionNote, acceptanceAttachments)
      if (!done.ok) return { ok: false, error: done.error, order: null }
      await reload()
      await reloadAttachments(acceptanceAttachments)
      return { ok: true, error: '', order: next }
    }

    await commitWorkOrderWrite({
      workOrder: next,
      attachments: acceptanceAttachments,
      logs: [logOf({ id: next.id, label: `${next.orderNo} ${next.title}` }, actor, `工单 ${next.orderNo}：${action}`, actionNote)],
    })
    await reload()
    await reloadAttachments(acceptanceAttachments)
    return { ok: true, error: '', order: next }
  }

  /**
   * 附件只做两件事：有照片时刷新附件 store，没有照片时不动。
   *
   * 验收照片是在工单事务里写进 attachments 表的，**不经过** `attachments.add()`；
   * 只刷新工单的话，工单详情会一直显示"验收照片 0 张"，得手动刷新页面才对
   * —— 库里数据是对的，错的只是内存里的那份列表。
   */
  async function reloadAttachments(written: IssueAttachment[]): Promise<void> {
    if (written.length === 0) return
    await useAttachmentStore().reload()
  }

  /**
   * 验收完成：工单与关联问题的状态、两条时间线、两条日志在**一个事务**里提交。
   *
   * 分两次写的后果是"工单已验收通过、问题还停在处理中"，从问题详情进去看状态对不上。
   * 问题已待复查（另一张工单已验收）或已关闭时只写工单 —— 那种情况下问题本就不该再动。
   */
  async function commitVerify(
    order: WorkOrder,
    actor: { name: string; roleLabel: string },
    note: string,
    acceptancePhotos: IssueAttachment[],
  ): Promise<{ ok: boolean; error: string }> {
    const logs = [logOf({ id: order.id, label: `${order.orderNo} ${order.title}` }, actor, `工单 ${order.orderNo}：验收通过`, note)]
    if (order.issueId === null) {
      await commitWorkOrderWrite({ workOrder: order, attachments: acceptancePhotos, logs })
      return { ok: true, error: '' }
    }
    const issue = await db.issues.get(order.issueId)
    if (issue === undefined) {
      return { ok: false, error: `关联问题不存在（${order.issueId}），验收结果无法写入，请先核对数据` }
    }
    const nextIssue = issueAfterVerify(issue, {
      orderNo: order.orderNo,
      at: order.updatedAt,
      by: actor.name,
      byRole: actor.roleLabel,
    })
    if (nextIssue === issue) {
      await commitWorkOrderWrite({ workOrder: order, attachments: acceptancePhotos, logs })
      return { ok: true, error: '' }
    }
    await commitVerifyWithIssue({
      workOrder: order,
      issue: nextIssue,
      attachments: acceptancePhotos,
      logs: [
        ...logs,
        logOf(
          { id: nextIssue.id, label: `${nextIssue.issueNo} ${nextIssue.anomalyType}` },
          actor,
          `问题 ${nextIssue.issueNo}：工单 ${order.orderNo} 验收通过，进入待复查`,
          note,
        ),
      ],
    })
    return { ok: true, error: '' }
  }


  function isAcceptanceAction(to: WorkOrderStatus): boolean {
    return to === 'verified' || to === 'returned'
  }

  function withAcceptancePhotoCount(note: string, count: number): string {
    return count === 0 ? note : `${note}｜验收照片 ${count} 张`
  }

  /** 验收照片只构造、不提前写库；最终由验收事务与状态、日志一起落盘。 */
  function buildAcceptancePhotos(orderId: string, drafts: DraftPhotoInput[] | undefined, actor: string): IssueAttachment[] {
    return (drafts ?? []).map((draft) => buildDraftPhoto(draft, {
      kind: 'acceptance', issueId: null, workOrderId: orderId, actor,
    }))
  }

  /** 一条操作日志：点名对象与业务编号，事后可倒查。 */
  function logOf(
    target: { id: string; label: string },
    actor: { name: string; roleLabel: string },
    summary: string,
    reason: string,
  ): AuditLog {
    return buildAuditLog({
      actor: actor.name,
      actorRole: actor.roleLabel,
      action: 'update',
      objectType: 'system',
      objectId: target.id,
      objectLabel: target.label,
      summary,
      reason,
    })
  }

  /**
   * 处置依据判定（页面提示用，读内存快照）：用于实时显示"还差什么"。
   * **真正决定能不能关的那一次判定走 basisFromDb()** —— 缓存可能命中但已过期。
   */
  function basisFor(input: { eventId: string | null; pointId: string | null; noRepairNote: string }) {
    return closeBasis({ orders: orders.value, ...input })
  }

  /** 处置依据判定（写入路径用，读库）：关闭事件前必须用它复核一次。 */
  async function basisFromDb(input: { eventId: string | null; pointId: string | null; noRepairNote: string }) {
    return closeBasis({ orders: await db.workOrders.toArray(), ...input })
  }

  async function reset(): Promise<void> {
    orders.value = []
    loaded.value = false
  }

  return {
    orders,
    loaded,
    openOrders,
    byId,
    ordersOfIssue,
    ordersOfPoint,
    basisFor,
    basisFromDb,
    buildForIssue,
    advanceOrder,
    reload,
    reset,
  }
})

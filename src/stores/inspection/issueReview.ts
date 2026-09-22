/**
 * 审核写入的辅助：关联目标解析与三方写入构造。
 *
 * 从 store 里抽出来的原因有两个：一是 `reviewIssue` 已经长到 140 多行，
 * 二是这两件事本身就有独立含义 —— "目标到底存不存在"与"要写哪几条记录"，
 * 单独放一处才看得清关联是双向的（源问题、目标问题、预警事件各写什么）。
 */
import { db } from '@/db/database'
import { nowIso } from '@/core/time'
import { buildAuditLog } from '@/db/repo'
import { NO_FAULT_MIN_LENGTH, type InspectionIssue, type IssueAttachment, type ReviewAction, type WorkOrder } from '@/types/inspection'
import { buildDraftPhoto, type DraftPhotoInput } from '@/db/inspection/attachments'
import { commitIssueLink, commitIssueWithWorkOrder } from '@/db/inspection/disposal'
import { review, reviewActionLabel, reviewCategoryLabel } from '@/core/inspection/issueMerge'
import type { AlarmEvent } from '@/types/events'
import type { AuditLog } from '@/types/domain'

export interface LinkTargets {
  targetIssue: InspectionIssue | null
  targetEvent: AlarmEvent | null
}

export interface LinkResolution {
  ok: boolean
  error: string
  targets: LinkTargets
}

/**
 * 解析关联目标：必须真实存在（读库），不能指向自己；
 * 关联到已关闭问题属于例外情况，要求在审核意见里写明专门依据。
 */
export async function resolveLinkTargets(input: {
  issue: InspectionIssue
  action: ReviewAction
  category: string
  note: string
  duplicateOf: string | null
  linkedEventId: string | null
}): Promise<LinkResolution> {
  const empty: LinkTargets = { targetIssue: null, targetEvent: null }
  if (input.action !== 'link_object') return { ok: true, error: '', targets: empty }

  if (input.category === 'issue') {
    const targetId = input.duplicateOf ?? ''
    if (targetId === input.issue.id) return { ok: false, error: '不能把问题关联到它自己', targets: empty }
    const found = await db.issues.get(targetId)
    if (found === undefined) return { ok: false, error: '要关联的问题不存在（可能已被删除）', targets: empty }
    if (found.status === 'closed' && input.note.trim().length < NO_FAULT_MIN_LENGTH) {
      return {
        ok: false,
        error: `要关联的问题已关闭，关联到已关闭档案需在审核意见里写明专门依据（不少于 ${NO_FAULT_MIN_LENGTH} 个字）`,
        targets: empty,
      }
    }
    return { ok: true, error: '', targets: { targetIssue: found, targetEvent: null } }
  }

  const found = await db.events.get(input.linkedEventId ?? '')
  if (found === undefined) return { ok: false, error: '要关联的预警事件不存在', targets: empty }
  return { ok: true, error: '', targets: { targetIssue: null, targetEvent: found } }
}

export interface ReviewWriteInput {
  issue: InspectionIssue
  targets: LinkTargets
  action: ReviewAction
  category: string
  status: InspectionIssue['status']
  actionLabel: string
  categoryLabel: string
  note: string
  /** 现场没法拍照时写的原因：一并写进时间线，事后能解释"为什么没有照片" */
  noPhotoReason: string
  actor: string
  actorRole: string
}

export interface PerformReviewInput {
  issue: InspectionIssue
  action: ReviewAction
  category: string
  note: string
  duplicateOf: string | null
  linkedEventId: string | null
  /** 本次随审核一起落库的现场照片草稿（草稿已是压缩图，事务内直接写） */
  photoDrafts: DraftPhotoInput[]
  /** 现场没法拍照时写的原因 */
  noPhotoReason: string
  actor: string
  actorRole: string
  /** 转维修时用：构造一张"待派工"工单（单号留空，由事务分配） */
  buildOrder: (issue: InspectionIssue) => WorkOrder
}

export interface PerformReviewResult {
  ok: boolean
  error: string
  issue: InspectionIssue | null
}

/**
 * 审核的完整写入路径：解析关联目标 → 判定 → 按出口提交。
 *
 * 放在这里而不是 store 里，是因为"每个出口写什么、关联怎么落"属于业务事实，
 * store 只该负责权限与重载；这样 reviewIssue() 也就不会越写越长。
 */
export async function performReview(input: PerformReviewInput): Promise<PerformReviewResult> {
  const note = input.note.trim()
  const resolved = await resolveLinkTargets({
    issue: input.issue,
    action: input.action,
    category: input.category,
    note,
    duplicateOf: input.duplicateOf,
    linkedEventId: input.linkedEventId,
  })
  if (!resolved.ok) return { ok: false, error: resolved.error, issue: null }

  /*
   * 判定看的是"本次操作后的状态"：照片是随这次审核一起写进问题行的，
   * 拿库里那份旧数据判断会把"刚补了现场照片"的提交误判成没有照片。
   */
  const photos = input.photoDrafts.map((draft) =>
    buildDraftPhoto(draft, { kind: 'scene', issueId: input.issue.id, workOrderId: null, actor: input.actor }),
  )
  const linked: InspectionIssue = {
    ...input.issue,
    photos: [...new Set([...input.issue.photos, ...photos.map((row) => row.id)])],
  }
  const outcome = review({
    issue: linked,
    action: input.action,
    category: input.category,
    note,
    duplicateOf: resolved.targets.targetIssue?.id ?? null,
    linkedEventId: resolved.targets.targetEvent?.id ?? null,
    photoCount: linked.photos.length,
    noPhotoReason: input.noPhotoReason,
    at: nowIso(),
    by: input.actor,
    byRole: input.actorRole,
  })
  if (!outcome.ok) return { ok: false, error: outcome.error, issue: null }

  const write = (row: InspectionIssue): ReviewWrites =>
    buildReviewWrites({
      issue: row,
      targets: resolved.targets,
      action: input.action,
      category: input.category,
      status: outcome.nextStatus,
      actionLabel: reviewActionLabel(input.action),
      categoryLabel: reviewCategoryLabel(input.action, input.category),
      note,
      noPhotoReason: input.noPhotoReason,
      actor: input.actor,
      actorRole: input.actorRole,
    })

  if (input.action === 'to_repair') {
    return commitRepairWithWorkOrder({
      issue: linked,
      photos,
      write,
      buildOrder: input.buildOrder,
      actor: input.actor,
      actorRole: input.actorRole,
      note,
      issueNo: input.issue.issueNo,
    })
  }

  const writes = write(linked)
  await commitIssueLink({
    source: writes.source,
    targetIssue: writes.nextTarget,
    event: writes.nextEvent,
    attachments: photos,
    logs: writes.logs,
  })
  return { ok: true, error: '', issue: writes.source }
}

export interface RepairOutcome {
  ok: boolean
  error: string
  issue: InspectionIssue | null
}

/**
 * 转维修：构造工单草稿，并把"单号分配 + 工单 + 问题状态变更 + 两条日志"放进一个事务提交。
 *
 * 与审核的其他出口分开写的原因很实际：只有这条出口会**新建一张工单**，
 * 而"问题进了处理中却没有工单"是答辩现场最容易被追问穿的假状态 —— 必须同生共死。
 * 单号也在这个事务里分配：在事务外先读最大值再写入，两条并发转维修会撞号。
 */
export async function commitRepairWithWorkOrder(input: {
  issue: InspectionIssue
  photos: IssueAttachment[]
  write: (issue: InspectionIssue) => ReviewWrites
  buildOrder: (issue: InspectionIssue) => WorkOrder
  actor: string
  actorRole: string
  note: string
  issueNo: string
}): Promise<RepairOutcome> {
  const draft = input.buildOrder(input.issue)
  const linked: InspectionIssue = {
    ...input.issue,
    workOrderIds: [...new Set([...input.issue.workOrderIds, draft.id])],
  }
  const writes = input.write(linked)
  await commitIssueWithWorkOrder({
    issue: writes.source,
    workOrder: draft,
    attachments: input.photos,
    buildLogs: (order) => [
      ...writes.logs,
      buildAuditLog({
        actor: input.actor,
        actorRole: input.actorRole,
        action: 'create',
        objectType: 'system',
        objectId: order.id,
        objectLabel: `${order.orderNo} ${order.title}`,
        summary: `由问题 ${input.issueNo} 生成维修工单 ${order.orderNo}（待派工）`,
        reason: input.note,
      }),
    ],
  })
  return { ok: true, error: '', issue: writes.source }
}

export interface ReviewWrites {
  source: InspectionIssue
  nextTarget: InspectionIssue | null
  nextEvent: AlarmEvent | null
  logs: AuditLog[]
}

/**
 * 构造三条写入：源问题（带审核结果与时间线）、目标问题（补"被关联"时间线与关联来源）、
 * 预警事件（补时间线节点），以及一条操作日志。三者由调用方放进同一个事务提交。
 */
export function buildReviewWrites(input: ReviewWriteInput): ReviewWrites {
  const { targets, note } = input
  const at = nowIso()
  const source = buildSourceRow(input, at)
  return {
    source,
    nextTarget: targets.targetIssue === null ? null : buildTargetRow(targets.targetIssue, source, input, at),
    nextEvent: targets.targetEvent === null ? null : buildEventRow(targets.targetEvent, source, note, input, at),
    logs: [
      buildAuditLog({
        actor: input.actor,
        actorRole: input.actorRole,
        action: 'update',
        objectType: 'system',
        objectId: source.id,
        objectLabel: `${source.issueNo} ${source.anomalyType}`,
        summary: `审核问题 ${source.issueNo}：${input.actionLabel}（${input.categoryLabel}）`,
        reason: note,
      }),
    ],
  }
}

/** 源问题：写入审核结果与审核时间线。 */
function buildSourceRow(input: ReviewWriteInput, at: string): InspectionIssue {
  const { issue, targets, action, category, note } = input
  const linked =
    targets.targetIssue !== null
      ? `｜关联到 ${targets.targetIssue.issueNo}`
      : targets.targetEvent !== null
        ? `｜关联到事件 ${targets.targetEvent.eventNo}`
        : ''
  // 「已当场处理」时把证据形态也写进时间线：有照片记张数，没照片记原因
  const evidence =
    input.noPhotoReason.trim() === ''
      ? action === 'close_no_fault' && category === 'handled'
        ? `｜现场照片 ${issue.photos.length} 张`
        : ''
      : `｜无法拍照原因：${input.noPhotoReason.trim()}`
  return {
    ...issue,
    status: input.status,
    reviewAction: action,
    reviewCategory: category,
    reviewedAt: at,
    reviewedBy: input.actor,
    reviewNote: note,
    duplicateOf: targets.targetIssue === null ? issue.duplicateOf : targets.targetIssue.id,
    linkedEventId: targets.targetEvent === null ? issue.linkedEventId : targets.targetEvent.id,
    updatedAt: at,
    updatedBy: input.actor,
    timeline: [
      ...issue.timeline,
      {
        at,
        by: input.actor,
        byRole: input.actorRole,
        action: `审核：${input.actionLabel}（${input.categoryLabel}）`,
        detail: `${note}${linked}${evidence}`,
      },
    ],
  }
}

/** 目标问题：补一条"被关联"时间线与关联来源清单，不删除、不改状态。 */
function buildTargetRow(target: InspectionIssue, source: InspectionIssue, input: ReviewWriteInput, at: string): InspectionIssue {
  return {
    ...target,
    linkedFrom: [...new Set([...target.linkedFrom, source.id])],
    updatedAt: at,
    updatedBy: input.actor,
    timeline: [
      ...target.timeline,
      {
        at,
        by: input.actor,
        byRole: input.actorRole,
        action: '被关联',
        detail: `${source.issueNo}（${source.anomalyType}）关联到本条问题：${input.note}`,
      },
    ],
  }
}

/** 预警事件：补一条关联节点，事件本身的状态与等级不动。 */
function buildEventRow(event: AlarmEvent, source: InspectionIssue, note: string, input: ReviewWriteInput, at: string): AlarmEvent {
  return {
    ...event,
    timeline: [
      ...event.timeline,
      {
        at,
        by: input.actor,
        detail: `问题 ${source.issueNo}（${source.anomalyType}）关联到本事件：${note}`,
        action: '记录关联问题',
      },
    ],
  }
}
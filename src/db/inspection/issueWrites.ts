/**
 * 问题写入的事务服务：问题行、任务关联与操作日志的事务提交都在这里。
 *
 * 两个关键设计：
 * ① **同一提交标识 = 同一个主键**（`issueIdOf()` 由提交标识确定性推出）。
 *    并发双击时两个请求算出同一个 id，第二个 `add()` 会撞主键 —— 这就是天然的唯一约束，
 *    不需要额外加唯一索引（也就不必冒"旧库已有重复数据导致升级失败"的风险）。
 * ② **编号在事务内分配**：IndexedDB 对同一 store 的读写事务是串行的，
 *    第二个事务读到的是第一个事务提交后的最大值，因此并发下不会算出同一个编号。
 */
import { db } from '@/db/database'
import { toPlain } from '@/core/plain'
import { allocateIssueNo } from './numbering'
import type { AuditLog } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, InspectionTask, IssueAttachment, IssueSource } from '@/types/inspection'

/**
 * 提交标识 → 问题主键：**完整标识的 base64url 编码**。
 *
 * 为什么不用哈希：32 位哈希会有碰撞，一旦两条不同的提交算出同一个主键，
 * 后一条会被当成"已存在"而**静默复用**——两次不同的发现被并成一条，现场事实就丢了。
 * 用完整标识编码则不存在碰撞面（也就没有"理论碰撞率"这种需要解释的东西）。
 */
export function issueIdOf(submissionKey: string): string {
  return `iss_${base64Url(submissionKey)}`
}

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface IssueRowMeta {
  actor: string
  actorRole: string
  at: string
}

export interface IssueRowDraft {
  source: IssueSource
  submissionKey: string
  pointId: string | null
  buildingId: string
  floorId: string
  zoneId: string
  eventId: string | null
  taskId: string | null
  /** 来源是保养任务时填任务 ID（其余来源不传，构造时会补 null） */
  maintenanceTaskId?: string | null
  anomalyType: string
  description: string
  photos: string[]
  detail: string
}

/** 构造问题行（不写库、不分配编号）：编号与日志在事务内基于最终行生成。 */
export function planIssueRow(draft: IssueRowDraft, meta: IssueRowMeta): InspectionIssue {
  return {
    id: issueIdOf(draft.submissionKey),
    issueNo: '',
    source: draft.source,
    submissionKey: draft.submissionKey,
    pointId: draft.pointId,
    buildingId: draft.buildingId,
    floorId: draft.floorId,
    zoneId: draft.zoneId,
    eventId: draft.eventId,
    taskId: draft.taskId,
    maintenanceTaskId: draft.maintenanceTaskId ?? null,
    anomalyType: draft.anomalyType,
    description: draft.description,
    photos: [...draft.photos],
    status: 'pending_review',
    reviewAction: null,
    reviewCategory: '',
    reviewedAt: null,
    reviewedBy: '',
    reviewNote: '',
    duplicateOf: null,
    linkedEventId: null,
    linkedFrom: [],
    workOrderIds: [],
    rechecks: [],
    timeline: [{ at: meta.at, by: meta.actor, byRole: meta.actorRole, action: '提交问题', detail: draft.detail }],
    createdAt: meta.at,
    createdBy: meta.actor,
    updatedAt: meta.at,
    updatedBy: meta.actor,
  }
}

export interface CreateIssueInput {
  issue: InspectionIssue
  /** 与问题一起提交的任务（带关联结果）；只建问题不关联任务时传 null */
  task: InspectionTask | null
  /**
   * 随问题一起落库的附件（草稿已压缩，不写库只构造）。
   *
   * 附件**不先单独入库**：先写照片再建问题，第二步失败会留下"照片已在库、问题却没有"的
   * 半成品 —— 或者反过来，问题建好了照片没挂上。两者都必须同生共死。
   * 附件主键由草稿标识确定性推出，所以同一批草稿重复提交只会覆盖同一行，不会重复新增。
   */
  attachments?: IssueAttachment[]
  /** 重试命中已存在的问题、且这次带了新照片时，用它写一条"补充照片"时间线（不静默新增） */
  photoTrace?: { at: string; by: string; byRole: string }
  /** 预警转问题时，同一事务把事件时间线一并写入；其他来源留空。 */
  eventId?: string | null
  buildEvent?: (event: AlarmEvent, issue: InspectionIssue) => AlarmEvent
  /** 日志要引用最终编号，因此传入构造函数、在事务内分配编号后再调用 */
  buildLogs: (issue: InspectionIssue) => AuditLog[]
}

export interface CreateIssueResult {
  created: boolean
  /** created=false 时是已存在的那条（并发或重试命中），照片可能已被补关联 */
  issue: InspectionIssue
}

export async function createIssueAtomic(input: CreateIssueInput): Promise<CreateIssueResult> {
  const photos = input.attachments ?? []
  return db.transaction('rw', db.issues, db.tasks, db.events, db.attachments, db.audits, async () => {
    const existing = await db.issues.get(input.issue.id)
    if (existing !== undefined) {
      /*
       * 命中同一主键时核对提交标识：主键由提交标识编码而来，理论上必然相同；
       * 这里做一道显式防线 —— 万一将来换了主键规则或数据被外部改写，
       * 宁可报错也不能把两次不同的提交静默并成一条。
       */
      if (existing.submissionKey !== input.issue.submissionKey) {
        throw new Error(
          `问题主键冲突：${input.issue.id} 已属于另一条提交（${existing.submissionKey}），本次为 ${input.issue.submissionKey}`,
        )
      }
      const issue = await mergeRetryPhotos(input, existing, photos)
      await mergeTaskIssueLink(input.task, issue)
      return { created: false, issue }
    }

    const issue: InspectionIssue =
      input.issue.issueNo === '' ? { ...input.issue, issueNo: await allocateIssueNo(input.issue.createdAt) } : input.issue
    await db.issues.add(toPlain(issue))
    await mergeTaskIssueLink(input.task, issue)
    if (photos.length > 0) await db.attachments.bulkPut(toPlain(photos))
    await appendEventTimeline(input, issue)
    const logs = input.buildLogs(issue)
    if (logs.length > 0) await db.audits.bulkPut(toPlain(logs))
    return { created: true, issue }
  })
}

/**
 * 将本次问题关联合并到事务内刚读取的任务行。
 *
 * 不能直接写调用方在事务外拼出的任务快照：并行到点或补充检查时，旧快照可能覆盖别人的
 * 到点尝试、清单答案。这里仅合并问题关联字段，其他逐点检查事实保持数据库当前值。
 */
async function mergeTaskIssueLink(candidate: InspectionTask | null, issue: InspectionIssue): Promise<void> {
  if (candidate === null) return
  const stored = await db.tasks.get(candidate.id)
  if (stored === undefined) throw new Error('巡检任务不存在，不能提交关联问题')
  const expected = candidate.results.find((row) => row.issueIds.includes(issue.id))
  if (expected === undefined) return
  const results = stored.results.map((row) => {
    if (row.pointId !== expected.pointId) return row
    const issueIds = [...new Set([...row.issueIds, issue.id])]
    const linkedIssueId = row.abnormalHandling.linkedIssueId ?? issue.id
    if (issueIds.length === row.issueIds.length && linkedIssueId === row.abnormalHandling.linkedIssueId) return row
    return { ...row, issueIds, abnormalHandling: { ...row.abnormalHandling, linkedIssueId } }
  })
  const taskIssueIds = [...new Set([...stored.issueIds, issue.id])]
  const unchanged = results.every((row, index) => row === stored.results[index]) && taskIssueIds.length === stored.issueIds.length
  if (unchanged) return
  await db.tasks.put(
    toPlain({ ...stored, results, issueIds: taskIssueIds, updatedAt: candidate.updatedAt, updatedBy: candidate.updatedBy }),
  )
}

/**
 * 重试命中已存在的问题时，把这次带来的**新**照片补进问题行。
 *
 * "新"是相对问题行已有的照片 ID 而言：同一张草稿的主键是确定的，重复提交不会新增附件行；
 * 但如果这次是**另一批**照片（用户重试时又补了两张），就必须写进问题并留一条时间线，
 * 不能让它们静默躺在附件表里。没有新照片时原样返回，不写库也不留痕。
 */
async function mergeRetryPhotos(
  input: CreateIssueInput,
  existing: InspectionIssue,
  photos: IssueAttachment[],
): Promise<InspectionIssue> {
  const added = photos.filter((row) => !existing.photos.includes(row.id))
  if (added.length === 0) return existing
  const trace = input.photoTrace
  const merged: InspectionIssue = {
    ...existing,
    photos: [...existing.photos, ...added.map((row) => row.id)],
    updatedAt: trace?.at ?? existing.updatedAt,
    updatedBy: trace?.by ?? existing.updatedBy,
    timeline:
      trace === undefined
        ? existing.timeline
        : [
            ...existing.timeline,
            {
              at: trace.at,
              by: trace.by,
              byRole: trace.byRole,
              action: '补充照片',
              detail: `同一次上报重试补入 ${added.length} 张现场照片`,
            },
          ],
  }
  await db.attachments.bulkPut(toPlain(added))
  await db.issues.put(toPlain(merged))
  return merged
}

async function appendEventTimeline(input: CreateIssueInput, issue: InspectionIssue): Promise<void> {
  if (input.eventId === undefined || input.eventId === null || input.buildEvent === undefined) return
  const event = await db.events.get(input.eventId)
  if (event === undefined) throw new Error('预警事件不存在，不能转问题处理')
  await db.events.put(toPlain(input.buildEvent(event, issue)))
}

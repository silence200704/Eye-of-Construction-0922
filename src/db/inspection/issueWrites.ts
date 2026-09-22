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
import type { InspectionIssue, InspectionTask, IssueSource } from '@/types/inspection'

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
  /** 预警转问题时，同一事务把事件时间线一并写入；其他来源留空。 */
  eventId?: string | null
  buildEvent?: (event: AlarmEvent, issue: InspectionIssue) => AlarmEvent
  /** 日志要引用最终编号，因此传入构造函数、在事务内分配编号后再调用 */
  buildLogs: (issue: InspectionIssue) => AuditLog[]
}

export interface CreateIssueResult {
  created: boolean
  /** created=false 时是已存在的那条（并发或重试命中） */
  issue: InspectionIssue
}

export async function createIssueAtomic(input: CreateIssueInput): Promise<CreateIssueResult> {
  return db.transaction('rw', db.issues, db.tasks, db.events, db.audits, async () => {
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
      return { created: false, issue: existing }
    }

    const issue: InspectionIssue =
      input.issue.issueNo === '' ? { ...input.issue, issueNo: await allocateIssueNo(input.issue.createdAt) } : input.issue
    await db.issues.add(toPlain(issue))
    if (input.task !== null) await db.tasks.put(toPlain(input.task))
    await appendEventTimeline(input, issue)
    const logs = input.buildLogs(issue)
    if (logs.length > 0) await db.audits.bulkPut(toPlain(logs))
    return { created: true, issue }
  })
}

async function appendEventTimeline(input: CreateIssueInput, issue: InspectionIssue): Promise<void> {
  if (input.eventId === undefined || input.eventId === null || input.buildEvent === undefined) return
  const event = await db.events.get(input.eventId)
  if (event === undefined) throw new Error('预警事件不存在，不能转问题处理')
  await db.events.put(toPlain(input.buildEvent(event, issue)))
}

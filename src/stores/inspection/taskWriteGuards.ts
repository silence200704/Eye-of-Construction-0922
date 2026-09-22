/**
 * 任务写入的公共前置：读取并校验写入上下文、构造随写入一起落库的日志。
 *
 * 抽出来的两点理由：
 * ① 并发下**必须读数据库**：内存快照可能是别处刚写完之前的旧版本，只看缓存会重复写关联与日志；
 * ② 这三个动作（到点、完成检查、上报问题）共用同一套校验口径，散在 store 里容易出现分叉。
 */
import { db } from '@/db/database'
import { buildAuditLog } from '@/db/repo'
import { ROLES } from '@/types/catalog'
import type { AuditLog } from '@/types/domain'
import type { Point } from '@/types/domain'
import type { InspectionIssue, InspectionTask, TaskCheckResult } from '@/types/inspection'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'

export interface TaskWriteContext {
  ok: true
  error: string
  task: InspectionTask
  result: TaskCheckResult
  point: Point
}

export interface TaskWriteFailure {
  ok: false
  error: string
}

/**
 * 读取并校验"这次写入针对哪个任务、哪个点位"。
 * 校验项：任务存在、执行角色匹配、点位在任务范围内、点位档案仍在。
 */
export async function loadWriteContext(taskId: string, pointId: string): Promise<TaskWriteContext | TaskWriteFailure> {
  // 以数据库为准：内存快照可能是并发写入之前的旧版本
  const task = (await db.tasks.get(taskId)) as InspectionTask | undefined
  if (task === undefined) return { ok: false, error: '任务不存在' }
  const session = useSessionStore()
  if (session.role !== task.planSnapshot.executorRole) {
    const role = ROLES.find((row) => row.key === task.planSnapshot.executorRole)?.name ?? task.planSnapshot.executorRole
    return { ok: false, error: `当前身份不能操作该任务：执行角色是「${role}」，请在系统设置切换身份` }
  }
  const result = task.results.find((row) => row.pointId === pointId)
  if (result === undefined) return { ok: false, error: '该点位不在本任务范围内' }
  const point = useArchiveStore().pointById(pointId)
  if (point === undefined) return { ok: false, error: '点位档案不存在或已归档' }
  return { ok: true, error: '', task, result, point }
}

/** 点位显示名（日志与提示共用）。 */
export function pointLabelOf(_task: InspectionTask, pointId: string): string {
  const point = useArchiveStore().pointById(pointId)
  return point === undefined ? pointId : `${point.code} ${point.name}`
}

export interface ReportLogInput {
  created: InspectionIssue
  task: InspectionTask
  point: Point
  actor: string
  actorRole: string
  detail: string
}

/** 上报问题时要一起落库的两条日志：建问题、任务关联。 */
export function buildReportLogs(input: ReportLogInput): AuditLog[] {
  const { created, task, point } = input
  return [
    buildAuditLog({
      actor: input.actor,
      actorRole: input.actorRole,
      action: 'create',
      objectType: 'system',
      objectId: created.id,
      objectLabel: `${created.issueNo} ${created.anomalyType}`,
      summary: `提交巡检问题 ${created.issueNo}`,
      reason: `来源：inspection；位置：${point.code} ${point.name}；照片 ${created.photos.length} 张；${input.detail}`,
    }),
    buildAuditLog({
      actor: input.actor,
      actorRole: input.actorRole,
      action: 'update',
      objectType: 'system',
      objectId: task.id,
      objectLabel: `${task.taskNo} ${point.code} ${point.name}`,
      summary: `任务关联问题 ${created.issueNo}（${point.code}）`,
      reason: `点位：${point.name}；问题：${created.issueNo}`,
    }),
  ]
}

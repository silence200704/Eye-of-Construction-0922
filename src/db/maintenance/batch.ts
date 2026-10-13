/**
 * 一次保养执行的写入批次组装（不写库）。
 *
 * 从 store 里拆出来的原因：那段逻辑超过 80 行 —— 既要构造问题行、又要跑判定、
 * 又要拼照片附件与审计日志。拆开之后职责清楚：
 * **本模块负责"要写什么"（纯构造 + 判定）**，`writes.writeMaintenanceExecute` 负责"写进去"，
 * store 只负责"在一个事务里按顺序调用"。事务边界与语义没有变化。
 */
import { buildAuditLog } from '@/db/repo'
import { issueIdOf } from '@/db/inspection/issueWrites'
import { buildDraftPhoto } from '@/db/inspection/attachments'
import { planMaintenanceExecute } from '@/core/maintenance/plan'
import type { AuditLog } from '@/types/domain'
import type { InspectionIssue, IssueAttachment } from '@/types/inspection'
import type { MaintenanceExecuteInput, MaintenanceTask } from '@/types/maintenance'

/** 由任务的快照位置构造问题行；编号留空，由写入事务分配。 */
export function maintenanceIssueOfTask(
  task: MaintenanceTask,
  input: MaintenanceExecuteInput,
  actor: { name: string; roleLabel: string },
  at: string,
): InspectionIssue {
  // 提交标识取任务业务键：同一次执行重试会算出同一条问题，不会重复建单
  const submissionKey = `mt_${task.id}`
  return {
    id: issueIdOf(submissionKey),
    issueNo: '',
    source: 'maintenance',
    submissionKey,
    pointId: task.snapshot.pointId,
    buildingId: task.snapshot.buildingId,
    floorId: task.snapshot.floorId,
    zoneId: task.snapshot.zoneId,
    eventId: null,
    taskId: null,
    maintenanceTaskId: task.id,
    anomalyType: '保养发现异常',
    description: input.anomaly.note.trim(),
    photos: [],
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
    timeline: [
      {
        at,
        by: actor.name,
        byRole: actor.roleLabel,
        action: '保养转问题',
        detail: `保养任务 ${task.taskNo}（${task.snapshot.deviceName}）检查异常：${input.anomaly.note.trim()}`,
      },
    ],
    createdAt: at,
    createdBy: actor.name,
    updatedAt: at,
    updatedBy: actor.name,
  }
}

export interface ExecuteBatch {
  ok: boolean
  error: string
  /** 完成后的任务行（含执行记录、双向关联） */
  task: MaintenanceTask
  photos: IssueAttachment[]
  logs: AuditLog[]
  issue: InspectionIssue | null
}

/**
 * 组装写入批次：判定用**库里那份任务 + 本次提交内容**（不看界面上的旧状态）。
 *
 * 顺序有讲究：先建问题行（只是构造，还没写库）拿到 ID，判定通过后把它写进执行记录，
 * 两边互为反向；判定不过就整体不提交，问题也不会落库。
 */
export function buildExecuteBatch(input: {
  task: MaintenanceTask
  exec: MaintenanceExecuteInput
  actor: { name: string; role: string; roleLabel: string }
  at: string
}): ExecuteBatch {
  const { task, exec, actor, at } = input
  const issue = exec.anomaly.createIssue ? maintenanceIssueOfTask(task, exec, actor, at) : null
  const check = planMaintenanceExecute({
    task,
    answers: exec.answers,
    measures: exec.measures,
    materials: exec.materials,
    nextDueDate: exec.nextDueDate,
    note: exec.note,
    abnormalNote: exec.anomaly.note,
    createIssue: exec.anomaly.createIssue,
    issueId: issue === null ? null : issue.id,
    actor,
    at,
  })
  if (!check.ok || check.next === null) {
    return { ok: false, error: check.error, task, photos: [], logs: [], issue: null }
  }
  const photos = exec.photoDrafts.map((draft) =>
    buildDraftPhoto(draft, {
      kind: 'scene',
      issueId: null,
      workOrderId: null,
      maintenanceTaskId: task.id,
      actor: actor.name,
    }),
  )
  const next: MaintenanceTask = {
    ...check.next,
    execution: check.next.execution === null ? null : { ...check.next.execution, photos: photos.map((row) => row.id) },
  }
  const logs: AuditLog[] = [
    buildAuditLog({
      actor: actor.name,
      actorRole: actor.roleLabel,
      action: 'update',
      objectType: 'system',
      objectId: task.id,
      objectLabel: `${next.taskNo} ${task.snapshot.deviceName}`,
      summary: `完成保养：${task.snapshot.planName}（${task.snapshot.deviceName}），下次保养 ${exec.nextDueDate}`,
      reason: exec.measures.trim(),
    }),
  ]
  if (issue !== null) {
    logs.push(
      buildAuditLog({
        actor: actor.name,
        actorRole: actor.roleLabel,
        action: 'create',
        objectType: 'system',
        objectId: issue.id,
        objectLabel: '保养发现异常',
        summary: `保养发现异常转问题：${task.snapshot.deviceName}（任务 ${task.taskNo}）`,
        reason: exec.anomaly.note.trim(),
      }),
    )
  }
  return { ok: true, error: '', task: next, photos, logs, issue }
}

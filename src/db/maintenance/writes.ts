/**
 * 保养数据的写入事务（V1-D 工作线 B）。
 *
 * 与巡检同一套纪律：
 * - **业务键主键**：任务 id = `计划ID@执行时刻`，并发重复生成会被数据库主键挡住，不需要额外唯一索引；
 * - **编号在事务内分配**：读当日最大值 +1 必须在读写事务里做，否则并发建单会撞号；
 * - **业务数据 + 附件 + 问题 + 审计日志同一事务**：执行保养时任务、照片、问题、时间线、日志一起落库，
 *   失败整体回滚，不留"任务已完成但照片没挂上"或"问题建了但任务没完成"的半成品；
 * - **判定依据读库不读缓存**：生成任务前在事务内重新确认计划仍启用、设备与测点仍有效。
 */
import { db } from '@/db/database'
import { toPlain } from '@/core/plain'
import { isoDayKey, nextMaintenancePlanCode, nextMaintenanceTaskNo } from '@/core/id'
import { allocateIssueNo } from '@/db/inspection/numbering'
import type { AuditLog } from '@/types/domain'
import type { InspectionIssue, IssueAttachment } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceTask } from '@/types/maintenance'

/** 事务内分配保养任务编号。 */
async function allocateTaskNo(at: string): Promise<string> {
  const rows = await db.maintenanceTasks.toArray()
  return nextMaintenanceTaskNo(isoDayKey(at), rows.map((row) => row.taskNo))
}

/** 事务内分配保养计划编号。 */
async function allocatePlanCode(at: string): Promise<string> {
  const rows = await db.maintenancePlans.toArray()
  return nextMaintenancePlanCode(isoDayKey(at), rows.map((row) => row.code))
}

/**
 * 新建或更新保养计划：编号在事务内分配，审计日志同事务。
 * 入参 `plan.code === ''` 表示新建，编号由本事务分配（并发建计划不会撞号）。
 */
export async function commitMaintenancePlan(input: {
  plan: MaintenancePlan
  logs: AuditLog[]
}): Promise<MaintenancePlan> {
  return db.transaction('rw', db.maintenancePlans, db.audits, async () => {
    const plan: MaintenancePlan =
      input.plan.code === '' ? { ...input.plan, code: await allocatePlanCode(input.plan.createdAt) } : input.plan
    await db.maintenancePlans.put(toPlain(plan))
    if (input.logs.length > 0) await db.audits.bulkPut(toPlain(input.logs))
    return plan
  })
}

/**
 * 启用/停用保养计划：**读当前行 → 判定 → 写回**在同一事务里完成。
 * 在事务外先读再写的话，两个人同时点"停用""启用"会按各自读到的旧状态覆盖，最终状态与日志不一致。
 */
export async function commitMaintenancePlanEnabled(input: {
  planId: string
  enabled: boolean
  actor: { name: string; roleLabel: string }
  at: string
}): Promise<{ ok: boolean; error: string; plan: MaintenancePlan | null }> {
  let error = ''
  let plan: MaintenancePlan | null = null
  await db.transaction('rw', db.maintenancePlans, db.audits, async () => {
    const row = await db.maintenancePlans.get(input.planId)
    if (row === undefined) {
      error = '保养计划不存在'
      return
    }
    if (row.enabled === input.enabled) {
      error = input.enabled ? '该计划已经是启用状态' : '该计划已经是停用状态'
      return
    }
    plan = { ...row, enabled: input.enabled, updatedAt: input.at, updatedBy: input.actor.name }
    await db.maintenancePlans.put(toPlain(plan))
    await db.audits.bulkPut(
      toPlain([
        {
          id: `log_${input.planId}_${input.enabled ? 'on' : 'off'}_${input.at}`,
          at: input.at,
          actor: input.actor.name,
          actorRole: input.actor.roleLabel,
          action: 'update' as const,
          objectType: 'system' as const,
          objectId: row.id,
          objectLabel: `${row.code} ${row.name}`,
          summary: `保养计划 ${row.code}：${input.enabled ? '启用' : '停用'}`,
          reason: '',
        },
      ]),
    )
  })
  return { ok: error === '', error, plan }
}

export interface GenerateResult {
  created: MaintenanceTask[]
  /** 已存在同业务键的任务而被跳过 */
  skippedExisting: number
  /** 事务内复核发现不该生成（计划已停用 / 设备或测点已失效），带原因说明 */
  rejected: string[]
}

/**
 * 生成某一天的保养任务（幂等 + 事务内复核）。
 *
 * 两层保护：业务键主键挡住"同一计划同一执行时刻"的重复；**事务内重新读计划、设备与测点**，
 * 挡住"读计划时还启用、提交时已被另一窗口停用"这类时间窗问题 —— 外面缓存里那份计划不算数。
 */
export async function commitMaintenanceGenerate(input: {
  drafts: { task: MaintenanceTask; log: AuditLog }[]
}): Promise<GenerateResult> {
  return db.transaction(
    'rw',
    db.maintenanceTasks,
    db.maintenancePlans,
    db.devices,
    db.points,
    db.audits,
    async () => {
      const created: MaintenanceTask[] = []
      const rejected: string[] = []
      let skippedExisting = 0
      for (const item of input.drafts) {
        const plan = await db.maintenancePlans.get(item.task.planId)
        if (plan === undefined || !plan.enabled) {
          rejected.push(`${item.task.snapshot.planName}：计划已停用或不存在`)
          continue
        }
        if ((await db.devices.get(item.task.deviceId)) === undefined) {
          rejected.push(`${item.task.snapshot.planName}：设备档案已删除`)
          continue
        }
        if (plan.pointId !== null && (await db.points.get(plan.pointId)) === undefined) {
          rejected.push(`${item.task.snapshot.planName}：测点档案已删除`)
          continue
        }
        if ((await db.maintenanceTasks.get(item.task.id)) !== undefined) {
          skippedExisting += 1
          continue
        }
        const task = { ...item.task, taskNo: await allocateTaskNo(item.task.plannedAt) }
        await db.maintenanceTasks.add(toPlain(task))
        await db.audits.put(toPlain(item.log))
        created.push(task)
      }
      return { created, skippedExisting, rejected }
    },
  )
}

/**
 * 完成保养的写入步骤：任务行（含执行记录）、现场照片、问题、审计日志。
 *
 * **必须在调用方的事务里执行**（调用方还要在同一个事务里先读任务、再判定、再建问题），
 * 所以这里不再自己开一层事务 —— 嵌套事务里一旦失败，外层很难干净地回滚。
 * 照片必须带 `maintenanceTaskId` 归属；问题带 `maintenanceTaskId`，与任务的 `execution.issueId` 互为反向。
 */
export async function writeMaintenanceExecute(input: {
  task: MaintenanceTask
  /** 现场照片：由 buildDraftPhoto 带 maintenanceTaskId 归属构造，本模块只负责落库 */
  photos: IssueAttachment[]
  logs: AuditLog[]
  /** 保养发现异常时另建的问题（只留痕或转问题，绝不自动升级为结构预警） */
  issue: InspectionIssue | null
}): Promise<void> {
  await db.maintenanceTasks.put(toPlain(input.task))
  if (input.photos.length > 0) await db.attachments.bulkPut(toPlain(input.photos))
  if (input.issue !== null) {
    /*
     * 问题编号在写入事务内分配，且只在首次创建时取号：
     * 重试命中同一条问题（主键来自 submissionKey）时沿用原编号，不会出现两条编号不同的问题。
     */
    const existing = await db.issues.get(input.issue.id)
    const issueNo =
      existing !== undefined && existing.issueNo !== '' ? existing.issueNo : await allocateIssueNo(input.task.updatedAt)
    await db.issues.put(toPlain({ ...input.issue, issueNo }))
  }
  if (input.logs.length > 0) await db.audits.bulkPut(toPlain(input.logs))
}

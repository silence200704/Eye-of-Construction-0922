/**
 * 保养任务仓储（V1-D 工作线 B）。
 *
 * 读取供保养工作台、设备一档与日历使用；写入两个受控入口：
 * - `generateForDay(dayKey)`：按周期生成当日任务，**同一计划同一执行时刻只有一条**（业务键主键）；
 * - `execute(taskId, input)`：完成任务，任务行 + 现场照片 + 审计日志（异常时再加问题）**同一事务**。
 *
 * 两条硬规矩：
 * ① 生成任务的判定读数据库、不读内存快照，编号在写入事务内分配；
 * ② 保养发现异常**只留痕或转问题**，绝不写入预警事件 —— 保养周期与结构监测预警是两条线，
 *    设备没按时保养不能变成建筑结构的红色预警（方案里的分层要求）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '@/db/database'
import { buildAuditLog } from '@/db/repo'
import { commitMaintenanceGenerate, writeMaintenanceExecute } from '@/db/maintenance/writes'
import { buildExecuteBatch } from '@/db/maintenance/batch'
import { plannedAtOf } from '@/core/inspection/taskPlan'
import { maintenanceAnswersOf, planMaintenanceTask } from '@/core/maintenance/plan'
import { nowIso } from '@/core/time'
import { useSessionStore } from '../session'
import { useIssueStore } from '../inspection/issues'
import { useAttachmentStore } from '../inspection/attachments'
import type { AuditLog } from '@/types/domain'
import type { ChecklistAnswer } from '@/types/inspection'
import type { MaintenanceExecuteInput, MaintenanceResult, MaintenanceTask } from '@/types/maintenance'

const EMPTY: MaintenanceResult = { ok: false, error: '', label: '', created: 0, skipped: 0 }

export const useMaintenanceTaskStore = defineStore('maintenanceTasks', () => {
  const tasks = ref<MaintenanceTask[]>([])
  const loaded = ref(false)

  async function reload(): Promise<void> {
    tasks.value = await db.maintenanceTasks.toArray()
    loaded.value = true
  }

  function byId(id: string): MaintenanceTask | undefined {
    return tasks.value.find((row) => row.id === id)
  }

  const tasksOfPlan = (planId: string): MaintenanceTask[] => tasks.value.filter((row) => row.planId === planId)
  const tasksOfDevice = (deviceId: string): MaintenanceTask[] => tasks.value.filter((row) => row.deviceId === deviceId)
  const pendingTasks = computed(() => tasks.value.filter((row) => row.status === 'pending'))

  /** 检查清单空白作答（执行面板初值）。 */
  function answersFor(id: string): ChecklistAnswer[] {
    const task = byId(id)
    return task === undefined ? [] : maintenanceAnswersOf(task.snapshot.checklist)
  }

  /**
   * 生成某一天的保养任务（幂等，可重复点击）。
   * 快照里的设备名与位置在这里读取一次并固定下来：改计划、设备调拨都不追溯改写历史任务。
   */
  async function generateForDay(dayKey: string): Promise<MaintenanceResult> {
    const session = useSessionStore()
    if (session.role !== 'safety' && session.role !== 'property') {
      return { ...EMPTY, error: '生成保养任务由学校安全管理人员或物业值班执行' }
    }
    // 读库而不是读内存：计划刚被别处改过时，缓存里的旧版本会生成不该生成的任务
    const plans = (await db.maintenancePlans.toArray()).filter((row) => row.enabled)
    const day = new Date(`${dayKey}T00:00:00`)
    if (!Number.isFinite(day.getTime())) return { ...EMPTY, error: '日期不是合法日期' }
    const at = nowIso()
    const drafts: { task: MaintenanceTask; log: AuditLog }[] = []
    for (const plan of plans) {
      const planned = plannedAtOf(plan, day)
      if (planned === null) continue
      const plannedAt = planned.toISOString()
      const device = await db.devices.get(plan.deviceId)
      const point = plan.pointId === null ? undefined : await db.points.get(plan.pointId)
      const task = planMaintenanceTask({
        plan,
        plannedAt,
        deviceCode: device?.code ?? '',
        deviceName: device?.name ?? '（设备档案已删除）',
        floorId: point?.floorId ?? '',
        zoneId: point?.zoneId ?? '',
        actor: { name: session.name, roleLabel: session.roleLabel },
        at,
      })
      drafts.push({
        task,
        log: buildAuditLog({
          actor: session.name,
          actorRole: session.roleLabel,
          action: 'create',
          objectType: 'system',
          objectId: task.id,
          objectLabel: `${task.snapshot.planCode} ${task.snapshot.deviceName}`,
          summary: `生成保养任务：${task.snapshot.planName}（设备 ${task.snapshot.deviceName}，负责人 ${task.snapshot.owner}）`,
          reason: '',
        }),
      })
    }
    try {
      const result = await commitMaintenanceGenerate({ drafts })
      await reload()
      const parts = [
        `新生成 ${result.created.length} 条`,
        result.skippedExisting === 0 ? '' : `已存在 ${result.skippedExisting} 条`,
        ...result.rejected,
      ].filter((row) => row !== '')
      return {
        ok: true,
        error: '',
        label: parts.join('；'),
        created: result.created.length,
        skipped: result.skippedExisting,
      }
    } catch (cause) {
      return { ...EMPTY, error: `生成失败，未写入数据：${cause instanceof Error ? cause.message : String(cause)}（可重试）` }
    }
  }

  /**
   * 完成保养：任务行、现场照片、审计日志（异常转问题时含问题行）同一事务提交。
   * 判定用**库里的任务行**，不用界面上的那份，避免两个窗口同时提交把同一周期做两遍。
   *
   * 事务内不吞异常：写入失败时必须让异常冒到 `transaction()` 之外，Dexie 才会真正中止事务 ——
   * 在事务回调里 catch 掉再正常返回，前面已经写进去的任务行会照常提交，就成了半成品。
   * 这里在事务外把失败翻译成界面能用的结果。
   */
  async function execute(taskId: string, input: MaintenanceExecuteInput): Promise<MaintenanceResult> {
    const session = useSessionStore()
    const at = nowIso()
    let error = ''
    let label = ''
    try {
      await db.transaction('rw', db.maintenanceTasks, db.attachments, db.issues, db.audits, async () => {
        const task = await db.maintenanceTasks.get(taskId)
        if (task === undefined) {
          error = '保养任务不存在'
          return
        }
        // 判定与组装都基于库里那份任务；事务里只做"读 → 组装 → 写"三步
        const batch = buildExecuteBatch({
          task,
          exec: input,
          actor: { name: session.name, role: session.role, roleLabel: session.roleLabel },
          at,
        })
        if (!batch.ok) {
          error = batch.error
          return
        }
        await writeMaintenanceExecute({ task: batch.task, photos: batch.photos, logs: batch.logs, issue: batch.issue })
        label = batch.task.taskNo
      })
    } catch (cause) {
      return { ...EMPTY, error: `保存失败，未写入数据：${cause instanceof Error ? cause.message : String(cause)}（可重试）` }
    }
    if (error !== '') return { ...EMPTY, error }
    await reload()
    /*
     * 跨域写入的缓存刷新：这次提交可能新建了一条问题与若干现场照片附件。
     * 只刷新保养仓储的话，从任务详情点「打开问题」会跳到一个"问题池里还没有"的对象上
     * （问题池显示 0 条、详情打不开），看起来像跳转坏了，其实是缓存没刷新。
     */
    await Promise.all([useIssueStore().reload(), useAttachmentStore().reload()])
    return { ok: true, error: '', label, created: 0, skipped: 0 }
  }

  async function reset(): Promise<void> {
    tasks.value = []
    loaded.value = false
  }

  return { tasks, loaded, pendingTasks, byId, tasksOfPlan, tasksOfDevice, answersFor, generateForDay, execute, reload, reset }
})

/**
 * 巡检任务仓储。
 *
 * 两条硬约束（方案 §3 + 评审要求）：
 * - 任务状态只能由逐点检查结果推导（`taskStatusOf`），任何地方都不许直接把任务改成"已检查"；
 * - 生成任务必须幂等：同一计划同一执行时刻只允许一条，重复点"生成任务"不会重复建单。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ChecklistAnswer, InspectionIssue, InspectionTask, TaskCheckResult } from '@/types/inspection'
import { backendActive } from '@/api/backend/runtime'
import { fetchInspectionTasks } from '@/api/backend/field'
import {
  checkInRemote,
  completePointRemoteSubmit,
  generateTasksRemote,
  submitTaskIssueRemote,
} from './remote/tasks'
import { applyCheckIn, completeCheck } from '@/core/inspection/checkIn'
import { buildDraftPhoto, type DraftPhotoInput } from '@/db/inspection/attachments'
import { createIssueAtomic, planIssueRow } from '@/db/inspection/issueWrites'
import {
  buildReportLogs,
  linkIssueToTask,
  loadWriteContext,
  pointLabelOf,
  writeTaskResult,
} from './taskWriteGuards'
import { useIssueStore } from './issues'
import { useAttachmentStore } from './attachments'
import { dayKeyOf, initialResults, isOverdue, planTasksFor, taskProgress, taskStatusOf, taskKeyOf } from '@/core/inspection/taskPlan'
import { nextTaskNo } from '@/core/id'
import { nowIso } from '@/core/time'
import { toPlain } from '@/core/plain'
import { db } from '@/db/database'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'
import { useClockStore } from '../clock'
import { usePlanStore } from './plans'

export interface GenerateResult {
  created: InspectionTask[]
  skipped: number
}

/** 受控入口的返回：失败时带原因，任务保持未改动 */
export interface EntryResult {
  ok: boolean
  error: string
  task: InspectionTask | null
}

/** 上报巡检问题的草稿（照片已压缩，但还未写库）。 */
export interface InspectionDraft {
  anomalyType: string
  description: string
  photoDrafts?: DraftPhotoInput[]
  /** 本点已经关联的问题：补传照片时复用它，不受 10 分钟提交窗口限制。 */
  reuseIssueId?: string | null
}

export interface IssueEntryResult {
  ok: boolean
  error: string
  issue: InspectionIssue | null
  duplicated?: boolean
}

export const useTaskStore = defineStore('inspectionTasks', () => {
  const tasks = ref<InspectionTask[]>([])
  const loaded = ref(false)
  /** 同一份草稿在失败后重试时复用 submissionId；成功后清掉。 */
  const pendingSubmission = new Map<string, string>()

  /** 共享时钟：今日待办与逾期判定按"现在"算，见 stores/clock.ts 的取舍说明。 */
  const clock = useClockStore()

  /** 立即刷新待办与逾期状态：推进时钟 + 重读任务。 */
  async function refreshNow(): Promise<void> {
    clock.refresh()
    await reload()
  }

  async function reload(): Promise<void> {
    tasks.value = backendActive() ? await fetchInspectionTasks() : await db.tasks.toArray()
    loaded.value = true
  }

  function byId(id: string): InspectionTask | undefined {
    return tasks.value.find((row) => row.id === id)
  }

  const tasksOfPlan = (planId: string): InspectionTask[] => tasks.value.filter((row) => row.planId === planId)

  /** 今日待办：计划时刻落在今天的任务（含已完成的，便于回看当天做了哪些）。 */
  const todayTasks = computed<InspectionTask[]>(() => {
    const key = dayKeyOf(new Date(clock.nowKey))
    return tasks.value
      .filter((row) => dayKeyOf(new Date(row.plannedAt)) === key)
      .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
  })

  /**
   * 我的任务：按任务快照里的执行角色过滤，不读当前计划。
   * 计划改了执行角色，已经派下去的旧任务仍归原角色，历史归属不被改写。
   */
  function tasksForRole(role: string): InspectionTask[] {
    return tasks.value
      .filter((row) => row.planSnapshot.executorRole === role)
      .sort((a, b) => {
        const done = (row: InspectionTask) => (row.status === 'pending' || row.status === 'partial' ? 0 : 1)
        return done(a) - done(b) || a.plannedAt.localeCompare(b.plannedAt)
      })
  }

  /**
   * 为某一天生成任务（幂等，且并发安全）。
   *
   * 唯一性落在数据库上：任务主键就是 `计划 ID + 执行时刻`，写入用 `add()`——
   * 已存在同键时 IndexedDB 直接抛 ConstraintError，因此并发双击两个异步调用
   * 也只会产生一条任务（内存里去重挡不住这种事）。
   * 序号也在同一个事务里按当时已有的任务算，避免并发算出同一个编号。
   */
  async function generateFor(day: Date, options: { planId?: string; beforeWrite?: () => void } = {}): Promise<GenerateResult> {
    if (backendActive()) {
      const pad = (value: number) => String(value).padStart(2, '0')
      const text = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
      const result = await generateTasksRemote(text)
      await reload()
      return result
    }
    const planStore = usePlanStore()
    const session = useSessionStore()
    const planned = planTasksFor(planStore.plans.filter((row) => options.planId === undefined || row.id === options.planId), day)
    const created: InspectionTask[] = []
    let skipped = 0

    await db.transaction('rw', db.tasks, db.plans, db.points, async () => {
      options.beforeWrite?.()
      if (options.planId !== undefined) {
        const current = await db.plans.get(options.planId)
        if (current === undefined || !current.enabled) throw new Error('巡检计划已失效或停用，不生成任务。')
        const points = await db.points.bulkGet(current.pointIds)
        if (points.some((row) => row === undefined || row.status !== 'active' || row.buildingId !== current.buildingId || !current.floorIds.includes(row.floorId))) throw new Error('巡检测点归属已改变，请先核对计划。')
        if (JSON.stringify(current) !== JSON.stringify(planned[0]?.plan)) throw new Error('巡检计划在准备后发生变化，请重读后再试。')
      }
      const rows = await db.tasks.toArray()
      const existingIds = new Set(rows.map((row) => row.id))
      const taskNos = rows.map((row) => row.taskNo)

      for (const item of planned) {
        const key = taskKeyOf(item.plan.id, item.plannedAt)
        if (existingIds.has(key)) {
          skipped += 1
          continue
        }
        const at = nowIso()
        const row: InspectionTask = {
          id: key,
          taskNo: nextTaskNo(dayKeyOf(new Date(item.plannedAt)), taskNos),
          planId: item.plan.id,
          buildingId: item.snapshot.buildingId,
          planSnapshot: item.snapshot,
          plannedAt: item.plannedAt,
          dueAt: item.dueAt,
          status: 'pending',
          results: initialResults(item.snapshot),
          issueIds: [],
          createdAt: at,
          createdBy: session.name,
          updatedAt: at,
          updatedBy: session.name,
        }
        await db.tasks.add(toPlain(row))
        existingIds.add(key)
        taskNos.push(row.taskNo)
        created.push(row)
      }
    })

    /*
     * 每条新建任务单独留痕，并带上可核对的上下文：计划编号、任务编号、唯一键。
     * 只写"生成 N 条"的话，日志里出现两条一模一样时无法判断是不是重复建单；
     * 全部跳过（幂等命中）时不写日志 —— 那只是页面提示"今日任务已是最新"，不是数据变更。
     */
    const archive = useArchiveStore()
    for (const task of created) {
      await archive.log(
        'create',
        'system',
        task.id,
        `${task.taskNo} ${task.planSnapshot.planName}`,
        `按 ${task.planSnapshot.planCode} 生成任务 ${task.taskNo}`,
        `唯一键：${task.id}；计划：${task.planSnapshot.planName}；执行角色：${task.planSnapshot.executorRole}；必查点 ${task.planSnapshot.pointIds.length} 个`,
      )
    }
    if (created.length > 0) await reload()
    return { created, skipped }
  }

  /**
   * 任务写入的三个受控入口。
   *
   * 页面**不能**直接改任务结果：任何"写 completed"的调用都必须经过这里 ——
   * 入口内读取任务、校验执行角色、调用纯函数判定，最后才落库。
   * 页面自己拼一个 `completed` 结果会被这套入口拒绝，而不是静默写进库。
   */
  async function attemptCheckIn(
    taskId: string,
    pointId: string,
    input: Omit<Parameters<typeof applyCheckIn>[1], 'point'>,
  ): Promise<EntryResult> {
    if (backendActive()) {
      const task = byId(taskId)
      if (task === undefined) return { ok: false, error: '任务不存在', task: null }
      try {
        const saved = await checkInRemote(task, pointId, input)
        await reload()
        return { ok: true, error: '', task: saved }
      } catch (cause) {
        return { ok: false, error: (cause as Error).message, task: null }
      }
    }
    const guard = await loadWriteContext(taskId, pointId)
    if (!guard.ok) return { ok: false, error: guard.error, task: null }
    const { task, result, point } = guard
    const next = applyCheckIn(result, { ...input, point })
    const last = next.attempts.length === 0 ? undefined : next.attempts[next.attempts.length - 1]
    return write(task, next, `到点尝试：${last?.message ?? ''}`)
  }

  async function completePointCheck(
    taskId: string,
    pointId: string,
    payload: { answers: ChecklistAnswer[]; linkedIssueId: string | null; noIssueReason: string },
  ): Promise<EntryResult> {
    if (backendActive()) {
      const task = byId(taskId)
      if (task === undefined) return { ok: false, error: '任务不存在', task: null }
      try {
        const saved = await completePointRemoteSubmit(task, pointId, payload)
        await reload()
        return { ok: true, error: '', task: saved }
      } catch (cause) {
        return { ok: false, error: (cause as Error).message, task: null }
      }
    }
    const guard = await loadWriteContext(taskId, pointId)
    if (!guard.ok) return { ok: false, error: guard.error, task: null }
    const { task, result } = guard

    // 问题必须真实存在，且属于本任务与点位；页面勾一个布尔值不算证据
    // 读库而非读缓存：缓存里那条可能已经关闭或改了归属
    const issue = payload.linkedIssueId === null ? undefined : await db.issues.get(payload.linkedIssueId)
    const issueValid =
      issue !== undefined && issue.taskId === task.id && issue.pointId === pointId && issue.status !== 'closed'

    const out = completeCheck({
      result,
      answers: payload.answers,
      requiredKeys: task.planSnapshot.checklist.filter((item) => item.required).map((item) => item.key),
      abnormalHandling: { linkedIssueId: payload.linkedIssueId, reason: payload.noIssueReason },
      issueValid,
      at: nowIso(),
    })
    if (!out.ok || out.next === null) return { ok: false, error: out.error, task: null }

    const written = await write(task, out.next, '提交检查完成')
    if (!written.ok) return written
    const abnormal = out.next.checklist.filter((row) => row.result === 'abnormal')
    if (abnormal.length > 0 && !issueValid) {
      // 依据要能被倒查：写进操作日志，谁在哪个点写了什么
      await useArchiveStore().log(
        'update',
        'system',
        task.id,
        `${task.taskNo} ${pointLabelOf(task, pointId)}`,
        `检查项异常但未建问题（${pointLabelOf(task, pointId)}）`,
        `无需建问题依据：${payload.noIssueReason.trim()}`,
      )
    }
    return written
  }

  /**
   * 上报巡检问题（唯一入口）。
   *
   * 为什么必须收在这里：巡检问题的"来源"就是这次任务到点检查，
   * 允许页面直接调 issueStore.submitIssue() 的话，任何人都能替巡检人员建"巡检发现"问题，
   * 执行角色形同虚设。入口内先 guardPoint()，再建问题、再关联点位。
   */
  async function reportInspectionIssue(taskId: string, pointId: string, draft: InspectionDraft): Promise<IssueEntryResult> {
    if (backendActive()) {
      const task = byId(taskId)
      if (task === undefined) return { ok: false, error: '任务不存在', issue: null }
      const existing =
        draft.reuseIssueId === undefined || draft.reuseIssueId === null
          ? undefined
          : useIssueStore().byId(draft.reuseIssueId)
      try {
        const out = await submitTaskIssueRemote(
          task,
          pointId,
          draft,
          pendingSubmission,
          existing?.submissionKey ?? null,
        )
        await reload()
        await useIssueStore().reload()
        await useAttachmentStore().reload()
        return { ok: true, error: '', issue: out.issue, duplicated: out.duplicated }
      } catch (cause) {
        return { ok: false, error: (cause as Error).message, issue: null }
      }
    }
    const guard = await loadWriteContext(taskId, pointId)
    if (!guard.ok) return { ok: false, error: guard.error, issue: null }
    const { task, result, point } = guard
    const issues = useIssueStore()
    const session = useSessionStore()

    const issueDraft = {
      source: 'inspection' as const,
      pointId: point.id,
      buildingId: point.buildingId,
      floorId: point.floorId,
      zoneId: point.zoneId,
      eventId: null,
      anomalyType: draft.anomalyType,
      description: draft.description,
      photos: [],
      taskId: task.id,
      detail: `${task.taskNo} 巡检发现：${draft.description}`,
    }
    const at = nowIso()
    const reused = draft.reuseIssueId === undefined || draft.reuseIssueId === null ? undefined : await db.issues.get(draft.reuseIssueId)
    if (reused !== undefined && (reused.taskId !== task.id || reused.pointId !== point.id)) {
      return { ok: false, error: '已关联问题不属于当前任务与点位，不能补传照片', issue: null }
    }
    const key = reused?.submissionKey ?? issues.submissionKeyFor(issueDraft)
    const issue = reused ?? planIssueRow({ ...issueDraft, submissionKey: key }, { actor: session.name, actorRole: session.roleLabel, at })
    const attachments = (draft.photoDrafts ?? []).map((item) =>
      buildDraftPhoto(item, { kind: 'scene', issueId: issue.id, workOrderId: null, actor: session.name }),
    )
    const issueWithPhotos: InspectionIssue = {
      ...issue,
      photos: [...new Set([...issue.photos, ...attachments.map((item) => item.id)])],
    }
    const next: TaskCheckResult = {
      ...result,
      issueIds: [...new Set([...result.issueIds, issueWithPhotos.id])],
      abnormalHandling: { ...result.abnormalHandling, linkedIssueId: issueWithPhotos.id },
    }
    const results = task.results.map((row) => (row.pointId === pointId ? next : row))
    const nextTask: InspectionTask = {
      ...task,
      results,
      status: taskStatusOf(results),
      updatedAt: at,
      updatedBy: session.name,
    }

    /*
     * 问题、任务结果与两条日志在**一个事务**里提交。
     * 分两次写会留下"问题已建但任务没关联"的半成品：页面重试只能靠时间窗去重，
     * 窗口一过就会再建一条，任务里却始终没有关联。
     */
    const created = await createIssueAtomic({
      issue: issueWithPhotos,
      task: nextTask,
      attachments,
      photoTrace: { at, by: session.name, byRole: session.roleLabel },
      buildLogs: (row) =>
        buildReportLogs({
          created: row,
          task,
          point,
          actor: session.name,
          actorRole: session.roleLabel,
          detail: issueDraft.detail,
        }),
    })

    await reload()
    await issues.reload()
    return { ok: true, error: '', issue: created.issue, duplicated: !created.created }
  }

  /** 统一的落库动作：任务状态一律由结果推导，失败不写库。 */
  async function write(task: InspectionTask, result: TaskCheckResult, note: string): Promise<EntryResult> {
    const out = await writeTaskResult(task, result, note)
    if (out.ok) await reload()
    return out
  }

  /** 把已存在的问题关联到本任务与点位（上报问题成功后调用）。 */
  async function linkIssueToPoint(taskId: string, pointId: string, issueId: string): Promise<EntryResult> {
    const out = await linkIssueToTask(taskId, pointId, issueId)
    if (out.ok) await reload()
    return out
  }

  /** 任务级备注用不到独立状态字段：进度一并算好给页面用。 */
  function progressOf(task: InspectionTask): { completed: number; total: number; percent: number; overdue: boolean } {
    return { ...taskProgress(task.results), overdue: isOverdue(task, new Date(clock.nowKey)) }
  }

  async function reset(): Promise<void> {
    tasks.value = []
    loaded.value = false
  }

  return {
    tasks,
    loaded,
    todayTasks,
    tasksOfPlan,
    byId,
    reload,
    refreshNow,
    tasksForRole,
    generateFor,
    attemptCheckIn,
    completePointCheck,
    reportInspectionIssue,
    linkIssueToPoint,
    progressOf,
    reset,
  }
})

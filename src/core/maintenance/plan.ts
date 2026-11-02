/**
 * 保养计划 → 任务生成与执行判定（纯函数）。
 *
 * 复用的是巡检那套已经验证过的纪律：
 * - **业务键主键**：`计划ID@执行时刻`，并发点两次也只会有一条任务（由数据库主键挡住）；
 * - **计划快照**：任务保存生成当时的设备、周期、负责人与检查项，改计划不追溯改写历史；
 * - **判定输入是"本次操作后的状态"**：完成保养时校验收到的措施与清单，而不是库里那份旧的。
 */
import type { ChecklistAnswer, ChecklistItem, PlanCycle } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceSnapshot, MaintenanceTask } from '@/types/maintenance'
import { isValidDayKey } from '@/core/time'
import { plannedAtOf } from '@/core/inspection/taskPlan'

/** 计划执行时刻落在 [from, to] 区间内的那些天（闭区间，按本地日期逐天判断）。 */
export function maintenanceRunsOf(plan: Pick<MaintenancePlan, 'startDate' | 'endDate' | 'cycle'>, from: Date, to: Date): Date[] {
  const days: Date[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cursor.getTime() <= last.getTime()) {
    if (plannedAtOf(plan, cursor) !== null) days.push(new Date(cursor.getTime()))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

/**
 * 任务构造（不写库）：由计划 + 执行时刻生成一条待保养任务。
 * `taskNo` 留空 —— 编号必须在写入事务里分配，否则并发生成会撞号。
 */
export function planMaintenanceTask(input: {
  plan: MaintenancePlan
  plannedAt: string
  deviceCode: string
  deviceName: string
  floorId: string
  zoneId: string
  actor: { name: string; roleLabel: string }
  at: string
}): MaintenanceTask {
  return {
    id: maintenanceKeyOf(input.plan.id, input.plannedAt),
    taskNo: '',
    planId: input.plan.id,
    deviceId: input.plan.deviceId,
    plannedAt: input.plannedAt,
    dueAt: maintenanceDueAtOf(input.plannedAt),
    status: 'pending',
    snapshot: maintenanceSnapshotOf({
      plan: input.plan,
      deviceCode: input.deviceCode,
      deviceName: input.deviceName,
      floorId: input.floorId,
      zoneId: input.zoneId,
    }),
    execution: null,
    timeline: [
      {
        at: input.at,
        by: input.actor.name,
        byRole: input.actor.roleLabel,
        action: '生成保养任务',
        detail: `按计划 ${input.plan.code} 生成：${input.deviceName}，负责人 ${input.plan.owner}`,
      },
    ],
    createdAt: input.at,
    createdBy: input.actor.name,
    updatedAt: input.at,
    updatedBy: input.actor.name,
  }
}

/** 当日截止时刻：执行日 23:59:59（本地）。逾期判定与"还剩几天"共用它。 */
export function maintenanceDueAtOf(plannedAt: string): string {
  return endOfDayAt(localDayKey(new Date(plannedAt)))
}

/** 某一天（YYYY-MM-DD）的 23:59:59 时刻，ISO 串。 */
export function endOfDayAt(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map((part) => Number.parseInt(part, 10))
  return new Date(y, m - 1, d, 23, 59, 59).toISOString()
}

/** 保养任务业务键：同一计划同一执行时刻只有一条。 */
export function maintenanceKeyOf(planId: string, plannedAt: string): string {
  return `${planId}@${plannedAt}`
}

/** 计划快照：把"当时按什么要求保养"固定下来。 */
export function maintenanceSnapshotOf(input: {
  plan: MaintenancePlan
  deviceCode: string
  deviceName: string
  /** 生成任务当时的位置（任务生成时从测点档案取，之后再调拨也不改写历史） */
  floorId: string
  zoneId: string
}): MaintenanceSnapshot {
  return {
    planCode: input.plan.code,
    planName: input.plan.name,
    deviceCode: input.deviceCode,
    deviceName: input.deviceName,
    pointId: input.plan.pointId,
    // 位置一起固定：设备或测点日后调拨时，历史任务仍能说明"当时在哪栋楼哪一层做的"
    buildingId: input.plan.buildingId,
    floorId: input.floorId,
    zoneId: input.zoneId,
    owner: input.plan.owner,
    cycle: { ...input.plan.cycle },
    checklist: input.plan.checklist.map((item) => ({ ...item })),
  }
}

/**
 * 由周期推算下一次保养日期：**按周期直接算，不逐天搜索**。
 *
 * 逐天搜索要设一个上限，而上限一旦设小了（例如两年一次的计划），就会静默返回一个错日期。
 * 这里日/周按月直接加，月按"先加自然月、溢出时取目标月最后一天"处理 ——
 * 与巡检周期判定里"起始日 31 日在 2 月落到 28/29 日"是同一条规则。
 */
export function nextDueDateOf(cycle: PlanCycle, fromDayKey: string, today: string): string {
  const from = new Date(`${fromDayKey}T00:00:00`)
  if (!Number.isFinite(from.getTime())) return today
  const step = Math.max(1, Math.floor(cycle.interval))
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  if (cycle.unit === 'day') {
    next.setDate(next.getDate() + step)
  } else if (cycle.unit === 'week') {
    next.setDate(next.getDate() + 7 * step)
  } else {
    const wantedDay = next.getDate()
    next.setDate(1)
    next.setMonth(next.getMonth() + step)
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    next.setDate(Math.min(wantedDay, lastDay))
  }
  return localDayKey(next)
}

/** 本地日期串（YYYY-MM-DD）：执行时刻按本地时间存，换算时不能走 toISOString 折成 UTC。 */
export function localDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 逾期：还没完成、且当日截止时刻已过。 */
export function isMaintenanceOverdue(task: MaintenanceTask, now: Date): boolean {
  if (task.status === 'done') return false
  return new Date(task.dueAt).getTime() < now.getTime()
}

/** 距离执行日还有几天（负数表示逾期天数）。 */
export function maintenanceDaysLeft(task: MaintenanceTask, todayKey: string): number {
  const [y, m, d] = todayKey.split('-').map((part) => Number.parseInt(part, 10))
  // 截止时刻按本地日算：直接切 ISO 串前 10 位在非东八区会差一天
  const due = new Date(`${localDayKey(new Date(task.dueAt))}T00:00:00`)
  if (!Number.isFinite(due.getTime()) || !Number.isFinite(y)) return 0
  const today = Date.UTC(y, m - 1, d)
  return Math.round((due.getTime() - today) / 86_400_000)
}

export interface MaintenanceCheck {
  ok: boolean
  errors: string[]
}

/** 建计划时的校验：设备、周期、负责人、检查项都要站得住。 */
export function validateMaintenancePlan(draft: {
  name: string
  deviceId: string
  cycle: PlanCycle
  startDate: string
  endDate: string | null
  owner: string
  checklist: ChecklistItem[]
}): MaintenanceCheck {
  const errors: string[] = []
  if (draft.name.trim() === '') errors.push('计划名称必填')
  if (draft.deviceId.trim() === '') errors.push('必须选择要保养的设备')
  if (draft.owner.trim() === '') errors.push('必须指定保养负责人')
  if (draft.cycle.interval < 1) errors.push('周期间隔至少为 1')
  if (draft.cycle.atTime.trim() === '') errors.push('必须填写执行时刻')
  if (draft.startDate.trim() === '' || !isValidDayKey(draft.startDate)) errors.push('开始日期不是合法日期')
  if (draft.endDate !== null && draft.endDate.trim() !== '' && !isValidDayKey(draft.endDate)) {
    errors.push('结束日期不是合法日期')
  }
  if (draft.endDate !== null && draft.endDate.trim() !== '' && draft.endDate < draft.startDate) {
    errors.push('结束日期不能早于开始日期')
  }
  if (draft.checklist.length === 0) errors.push('至少要有一条保养检查项，否则执行时没有依据')
  if (draft.checklist.some((item) => item.label.trim() === '')) errors.push('检查项名称不能为空')
  return { ok: errors.length === 0, errors }
}

/** 执行保养时的校验：必答项全作答、措施必填、下次保养日期必须是合法日期。 */
export function planMaintenanceCompletion(input: {
  task: MaintenanceTask
  answers: ChecklistAnswer[]
  measures: string
  nextDueDate: string
}): { ok: boolean; error: string } {
  const { task } = input
  if (task.status === 'done') return { ok: false, error: '这条保养任务已经完成过了，一个周期只执行一次' }
  const pending = task.snapshot.checklist.filter((item) => item.required && (input.answers.find((row) => row.key === item.key)?.result ?? null) === null)
  if (pending.length > 0) {
    return { ok: false, error: `还有 ${pending.length} 条必答检查项没有作答（${pending.map((item) => item.label).join('、')}）` }
  }
  if (input.measures.trim() === '') return { ok: false, error: '必须填写维护措施，否则验收与复查没有依据' }
  if (!isValidDayKey(input.nextDueDate)) return { ok: false, error: '下次保养日期不是合法日期（需形如 2026-10-25，且日历上真实存在）' }
  return { ok: true, error: '' }
}

/** 执行后的任务行：状态、执行记录与时间线一起变成"已完成"。 */
export function maintenanceCompletedRow(input: {
  task: MaintenanceTask
  answers: ChecklistAnswer[]
  measures: string
  materials: string
  photos: string[]
  nextDueDate: string
  note: string
  /** 异常项描述（有异常项时必填，见 planMaintenanceExecute） */
  abnormalNote: string
  /** 本次执行转出的问题 ID；未转问题传 null */
  issueId: string | null
  at: string
  by: string
  byRole: string
}): MaintenanceTask {
  const abnormal = input.answers.filter((row) => row.result === 'abnormal').length
  const abnormalText = input.abnormalNote.trim() === '' ? '' : `；异常描述：${input.abnormalNote.trim()}`
  return {
    ...input.task,
    status: 'done',
    execution: {
      at: input.at,
      by: input.by,
      byRole: input.byRole,
      checklist: input.answers.map((row) => ({ ...row })),
      measures: input.measures.trim(),
      materials: input.materials.trim(),
      photos: [...input.photos],
      nextDueDate: input.nextDueDate,
      note: input.note.trim(),
      abnormalNote: input.abnormalNote.trim(),
      issueId: input.issueId,
    },
    updatedAt: input.at,
    updatedBy: input.by,
    timeline: [
      ...input.task.timeline,
      {
        at: input.at,
        by: input.by,
        byRole: input.byRole,
        action: '完成保养',
        detail: `措施：${input.measures.trim()}；异常项 ${abnormal} 条；照片 ${input.photos.length} 张；下次保养 ${input.nextDueDate}${abnormalText}${input.note.trim() === '' ? '' : `；${input.note.trim()}`}`,
      },
    ],
  }
}

/**
 * 检查清单作答的空白初值。
 * 结构与巡检的清单作答完全一致（`ChecklistAnswer`），两边的作答组件可以共用；
 * 但巡检的 `initialResults()` 是按**点位**展开的，保养清单是**项目**列表，所以这里单独构造。
 */
export function maintenanceAnswersOf(checklist: ChecklistItem[]): ChecklistAnswer[] {
  return checklist.map((item) => ({ key: item.key, label: item.label, result: null, note: '' }))
}

/**
 * 执行保养的准入判定（纯函数，输入是"库里那份任务 + 本次提交内容"）。
 *
 * 执行人应当是计划负责人；**物业值班可以代执行，但必须写明代执行原因** ——
 * 与工单"接单人必须是被派工人"同一条规则，否则事后查不出"谁做的、责任人是谁"。
 */
export function planMaintenanceExecute(input: {
  task: MaintenanceTask
  answers: ChecklistAnswer[]
  measures: string
  materials: string
  nextDueDate: string
  note: string
  /** 异常项描述：有异常项时必填 */
  abnormalNote: string
  /** 是否把本次异常转成问题处理 */
  createIssue: boolean
  /** 转问题时由调用方先在事务内创建问题行，再把 ID 传进来写进执行记录 */
  issueId: string | null
  actor: { name: string; role: string; roleLabel: string }
  at: string
}): { ok: boolean; error: string; abnormal: number; next: MaintenanceTask | null } {
  const deny = (error: string) => ({ ok: false, error, abnormal: 0, next: null })
  const check = planMaintenanceCompletion({
    task: input.task,
    answers: input.answers,
    measures: input.measures,
    nextDueDate: input.nextDueDate,
  })
  if (!check.ok) return deny(check.error)
  /*
   * 异常必填描述、无异常不得转问题：这两条原先只在页面层拦，其他入口直接调仓储就能写进
   * "有异常项但描述为空"甚至"没有异常却转出空描述问题"的记录。规则下沉到纯函数，
   * 页面、仓储、将来的接口调用都走同一条判定。
   */
  const abnormalCount = input.answers.filter((row) => row.result === 'abnormal').length
  if (abnormalCount > 0 && input.abnormalNote.trim() === '') {
    return deny(`有 ${abnormalCount} 项检查异常，必须写明异常描述，否则问题处理与验收没有依据`)
  }
  if (abnormalCount === 0 && input.createIssue) {
    return deny('本次没有异常项，不能按"转问题处理"提交')
  }
  if (input.createIssue && input.issueId === null) {
    return deny('选择转问题处理时，问题必须先在同一事务里创建成功（缺少问题编号）')
  }
  if (!input.createIssue && input.issueId !== null) {
    return deny('未选择转问题处理，执行记录不应关联问题')
  }
  const owner = input.task.snapshot.owner
  if (owner !== '' && input.actor.name !== owner) {
    if (input.actor.role !== 'property') {
      return deny(`本计划负责人是「${owner}」，请由负责人执行保养`)
    }
    if (input.note.trim() === '') {
      return deny(`物业值班代执行「${owner}」的保养任务必须写明代执行原因`)
    }
  }
  const abnormal = input.answers.filter((row) => row.result === 'abnormal').length
  return {
    ok: true,
    error: '',
    abnormal,
    next: maintenanceCompletedRow({
      task: input.task,
      answers: input.answers,
      measures: input.measures,
      materials: input.materials,
      photos: [],
      nextDueDate: input.nextDueDate,
      note: input.note,
      abnormalNote: input.abnormalNote,
      issueId: input.issueId,
      at: input.at,
      by: input.actor.name,
      byRole: input.actor.roleLabel,
    }),
  }
}

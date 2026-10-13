/**
 * 保养工作台的筛选、计数、台账、日历与分区（纯函数）。
 *
 * 单独一层的理由：工作台上每个数字都要能解释"它是怎么算出来的"——
 * 视图徽标的条数、台账的"下次保养日期"、四个分区的口径全在这里，页面只负责渲染。
 * 时间一律从入参拿（页面传共享刻度 stores/clock.ts 的 todayKey 与 nowKey），
 * 函数里不读系统时间：否则跨天与单元测试都不可复现。
 *
 * 分区口径是硬要求：**保养逾期绝不能进结构预警区**。
 * 设备没按时保养是设备管理问题，结构预警是建筑安全判定 —— 两者依据的层级不同
 * （结构预警背后有传感器证据链与规则判定，保养逾期只是一条排期），
 * 混在一块会让"该保养了"看起来像"建筑有险情"，因果是错的。
 */
import type { Device } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { WorkOrder } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceTask } from '@/types/maintenance'
import { isMaintenanceOverdue, localDayKey, maintenanceDaysLeft, maintenanceRunsOf } from './plan'

/** 工作台任务视图：四个视图互不代替，各自回答一个现场问题。 */
export type MaintenanceViewKey = 'today' | 'mine' | 'all' | 'overdue'

export const MAINTENANCE_VIEWS: { key: MaintenanceViewKey; label: string; sub: string }[] = [
  { key: 'today', label: '今日待办', sub: '执行日是今天的保养任务' },
  { key: 'mine', label: '我的保养', sub: '负责人是当前操作人的全部任务' },
  { key: 'all', label: '全部待办', sub: '还没完成的保养任务' },
  { key: 'overdue', label: '逾期', sub: '过了当日截止时刻仍未完成' },
]

/**
 * 台账与日历要的数据（页面只组装一次）。
 * 数据都来自既有仓储（archive / maintenance 两个 store），时间来自共享刻度 ——
 * 每个函数各拼一份的话，口径会悄悄走偏（例如某个页面忘了传今天）。
 */
export interface MaintenanceDataInput {
  plans: MaintenancePlan[]
  tasks: MaintenanceTask[]
  devices: Device[]
  /** 本地日期 YYYY-MM-DD 与当前时刻（共享刻度，见 stores/clock.ts） */
  todayKey: string
  now: Date
}

/**
 * 工作台视图与分区要的额外数据：当前操作人、工单与预警事件。
 * 视图与分区必须读真实数据源，不能拿别处的数字顶替。
 */
export interface MaintenanceBoardInput extends MaintenanceDataInput {
  workOrders: WorkOrder[]
  events: AlarmEvent[]
  /** 当前操作人姓名：「我的保养」按任务快照里的计划负责人比对 */
  actor: string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 执行时刻 → 本地日键；时刻非法时返回空串（不拿 "NaN-NaN-NaN" 当日期用）。 */
export function maintenancePlannedDay(plannedAt: string): string {
  const date = new Date(plannedAt)
  return Number.isFinite(date.getTime()) ? localDayKey(date) : ''
}

/** 任务状态展示：文字与色不过颜色单独表意，逾期直接给天数。 */
export interface MaintenanceTaskState {
  overdue: boolean
  daysLeft: number
  label: string
  tone: 'green' | 'orange' | 'red' | 'gray'
}

export function maintenanceTaskState(task: MaintenanceTask, todayKey: string, now: Date): MaintenanceTaskState {
  if (task.status === 'done') return { overdue: false, daysLeft: 0, label: '已完成', tone: 'green' }
  const daysLeft = maintenanceDaysLeft(task, todayKey)
  if (isMaintenanceOverdue(task, now)) {
    return { overdue: true, daysLeft, label: `逾期 ${Math.abs(daysLeft)} 天`, tone: 'red' }
  }
  if (daysLeft <= 0) return { overdue: false, daysLeft, label: '今天到期', tone: 'orange' }
  return { overdue: false, daysLeft, label: `还剩 ${daysLeft} 天`, tone: 'gray' }
}

/** 某个任务是否属于某个视图。 */
export function maintenanceTaskMatches(input: MaintenanceBoardInput, task: MaintenanceTask, view: MaintenanceViewKey): boolean {
  if (view === 'today') return maintenancePlannedDay(task.plannedAt) === input.todayKey
  // 「我的保养」按快照里的负责人比对：任务是按当时的计划生成的，事后改计划不该把我的历史任务转走
  if (view === 'mine') return task.snapshot.owner === input.actor
  if (view === 'all') return task.status !== 'done'
  // 逾期用 core 的判定：未完成 + 当日截止时刻已过；已完成的任务无论多晚都不算逾期
  return isMaintenanceOverdue(task, input.now)
}

/** 视图里的任务：按执行时刻升序（最早的排最前，逾期的一眼就能看到）。 */
export function maintenanceViewTasks(input: MaintenanceBoardInput, view: MaintenanceViewKey): MaintenanceTask[] {
  return input.tasks.filter((task) => maintenanceTaskMatches(input, task, view)).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
}

export interface MaintenanceViewResult {
  key: MaintenanceViewKey
  label: string
  sub: string
  tasks: MaintenanceTask[]
  count: number
}

/** 单个视图：任务与条数一起返回，页面的徽标与列表读同一份结果，不会对不上。 */
export function maintenanceViewOf(input: MaintenanceBoardInput, view: MaintenanceViewKey): MaintenanceViewResult {
  const def = MAINTENANCE_VIEWS.find((row) => row.key === view) ?? MAINTENANCE_VIEWS[0]
  const tasks = maintenanceViewTasks(input, view)
  return { key: def.key, label: def.label, sub: def.sub, tasks, count: tasks.length }
}

/** 四个视图的条数（徽标用）：与列表同一套过滤，点进去的条数必然一致。 */
export function maintenanceViewBadges(input: MaintenanceBoardInput): { key: MaintenanceViewKey; label: string; sub: string; count: number }[] {
  return MAINTENANCE_VIEWS.map((row) => ({ ...row, count: maintenanceViewTasks(input, row.key).length }))
}

/** 某天真实存在的任务（按执行时刻的本地日匹配，不用 UTC 日切片）。 */
export function maintenanceTasksOnDay(tasks: MaintenanceTask[], dayKey: string): MaintenanceTask[] {
  return tasks.filter((task) => maintenancePlannedDay(task.plannedAt) === dayKey).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
}

/**
 * 计划下一次执行日：从今天起在有限窗口内找第一个命中日。
 *
 * 窗口内没有命中（计划已结束、已停用或周期超过窗口）返回 null ——
 * **不编造日期**：拿一个猜出来的日子当"下次保养"比显示"暂无"更糟。
 */
export function planNextRunDate(plan: MaintenancePlan, todayKey: string, windowDays = 400): string | null {
  const from = new Date(`${todayKey}T00:00:00`)
  if (!Number.isFinite(from.getTime())) return null
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + windowDays)
  const hits = maintenanceRunsOf(plan, from, to)
  return hits.length === 0 ? null : localDayKey(hits[0])
}

/** 措施摘要：台账一行放不下整段措施，超长截断（只影响展示，不改数据）。 */
export function summarizeText(text: string, max = 24): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

export interface MaintenanceLastResult {
  taskNo: string
  /** 实际执行时间（ISO） */
  at: string
  by: string
  measures: string
  materials: string
  photoCount: number
  nextDueDate: string
}

/** 台账的"下次保养日期"来源：现场登记的排期 / 按周期推算 / 没有。 */
export type NextDueSource = 'execution' | 'plan' | 'none'

export interface MaintenanceLedgerRow {
  deviceId: string
  deviceCode: string
  deviceName: string
  /** 当前生效计划：优先启用中的计划，其次按编号取第一个；没有计划为 null */
  plan: MaintenancePlan | null
  planCount: number
  activePlanCount: number
  nextDueDate: string | null
  nextDueSource: NextDueSource
  /** 最近一次保养结果（时间、执行人、措施摘要、照片数） */
  lastResult: MaintenanceLastResult | null
  /** 历史保养次数（已完成）与任务总数 */
  doneCount: number
  taskCount: number
  pendingCount: number
  overdueCount: number
}

/** 按执行时间取最近一次已完成的保养（执行记录缺失的跳过，不能拿半个记录充数）。 */
function lastCompletedOf(tasks: MaintenanceTask[]): MaintenanceTask | null {
  return tasks
    .filter((row) => row.status === 'done' && row.execution !== null)
    .sort((a, b) => (a.execution?.at ?? '').localeCompare(b.execution?.at ?? ''))
    .pop() ?? null
}

function lastResultOf(tasks: MaintenanceTask[]): MaintenanceLastResult | null {
  const task = lastCompletedOf(tasks)
  const execution = task?.execution ?? null
  if (task === null || execution === null) return null
  return {
    taskNo: task.taskNo,
    at: execution.at,
    by: execution.by,
    measures: execution.measures,
    materials: execution.materials,
    photoCount: execution.photos.length,
    nextDueDate: execution.nextDueDate,
  }
}

/** 当前生效计划：启用中的优先，同状态下按编号排序，保证同一份数据每次取到同一个。 */
function preferredPlanOf(plans: MaintenancePlan[]): MaintenancePlan | null {
  const sorted = [...plans].sort((a, b) => a.code.localeCompare(b.code))
  return sorted.find((row) => row.enabled) ?? sorted[0] ?? null
}

/**
 * 下次保养日期：**现场登记的排期优先于按周期推算**。
 * 最近一次执行填的"下次保养日期"是人对这台设备的真实安排（可能按周期改过），
 * 拿周期重算一遍会把人的调整抹掉。
 */
function nextDueOf(plan: MaintenancePlan | null, tasks: MaintenanceTask[], todayKey: string): { date: string | null; source: NextDueSource } {
  const registered = lastCompletedOf(tasks)?.execution?.nextDueDate ?? ''
  if (registered !== '') return { date: registered, source: 'execution' }
  if (plan === null || !plan.enabled) return { date: null, source: 'none' }
  const computed = planNextRunDate(plan, todayKey)
  return computed === null ? { date: null, source: 'none' } : { date: computed, source: 'plan' }
}

/**
 * 保养台账：**只列有保养计划或保养任务的设备**。
 * 把全校设备都列进来会得到一张大部分是"暂无保养计划"的表，看不出工作量；
 * 没有保养数据的设备台数由页面另外报一个数（见台账页的提示行）。
 */
export function maintenanceLedger(input: MaintenanceDataInput): MaintenanceLedgerRow[] {
  return input.devices
    .map((device) => {
      const plans = input.plans.filter((row) => row.deviceId === device.id)
      const tasks = input.tasks.filter((row) => row.deviceId === device.id)
      if (plans.length === 0 && tasks.length === 0) return null
      const plan = preferredPlanOf(plans)
      const due = nextDueOf(plan, tasks, input.todayKey)
      const row: MaintenanceLedgerRow = {
        deviceId: device.id,
        deviceCode: device.code,
        deviceName: device.name,
        plan,
        planCount: plans.length,
        activePlanCount: plans.filter((item) => item.enabled).length,
        nextDueDate: due.date,
        nextDueSource: due.source,
        lastResult: lastResultOf(tasks),
        doneCount: tasks.filter((item) => item.status === 'done').length,
        taskCount: tasks.length,
        pendingCount: tasks.filter((item) => item.status !== 'done').length,
        overdueCount: tasks.filter((item) => isMaintenanceOverdue(item, input.now)).length,
      }
      return row
    })
    .filter((row): row is MaintenanceLedgerRow => row !== null)
    .sort((a, b) => a.deviceCode.localeCompare(b.deviceCode))
}

/** 一台设备的保养记录（按执行时刻倒序，最近的在最前）。 */
export function maintenanceRecordsOf(tasks: MaintenanceTask[], deviceId: string): MaintenanceTask[] {
  return tasks.filter((row) => row.deviceId === deviceId).sort((a, b) => b.plannedAt.localeCompare(a.plannedAt))
}

export type MaintenanceZoneKey = 'maintenance_overdue' | 'device_offline' | 'work_order' | 'structure_alarm'

/** 分区点击后的去向：本页工作台视图，或别的页面 + 查询参数。 */
export type MaintenanceZoneTarget =
  | { kind: 'view'; view: MaintenanceViewKey }
  | { kind: 'route'; path: string; query: Record<string, string> }

export interface MaintenanceZone {
  key: MaintenanceZoneKey
  title: string
  count: number
  unit: string
  /** 口径：这一块的数字怎么算出来的，页面上直接显示，数字有出处 */
  criteria: string
  target: MaintenanceZoneTarget
}

/**
 * 四个互不混用的分区：保养逾期 / 设备离线 / 故障工单 / 结构预警。
 *
 * 每一块的数据源都不同（保养任务、设备档案、维修工单、预警事件），
 * 所以一块里的数字永远只由它自己的数据源决定 —— 保养逾期再多也不会让结构预警涨一条。
 */
export function maintenanceZones(input: MaintenanceBoardInput): MaintenanceZone[] {
  const overdue = maintenanceViewTasks(input, 'overdue').length
  // 只数在册设备：已归档设备不在役，列进"离线待排查"会给出一个没法处理的数字
  const offline = input.devices.filter((row) => row.status === 'active' && row.health === 'offline').length
  // 未验收即未完成：待派工、待接单、处理中、待验收、验收退回都要继续推
  const orders = input.workOrders.filter((row) => row.status !== 'verified').length
  // 未关闭的预警事件（待确认 / 处理中 / 恢复待确认）：数据源是预警事件表，保养任务不参与
  const alarms = input.events.filter((row) => row.status !== 'closed').length
  return [
    {
      key: 'maintenance_overdue',
      title: '保养逾期',
      count: overdue,
      unit: '条任务',
      criteria: '保养任务未完成且已过执行日 23:59；不参与结构预警计数',
      target: { kind: 'view', view: 'overdue' },
    },
    {
      key: 'device_offline',
      title: '设备离线',
      count: offline,
      unit: '台设备',
      criteria: '在册设备档案中健康状况为「离线 / 待排查」（已归档设备不计入）',
      target: { kind: 'route', path: '/archive', query: { health: 'offline' } },
    },
    {
      key: 'work_order',
      title: '故障工单',
      count: orders,
      unit: '张工单',
      criteria: '维修工单中还没验收通过的（待派工 / 待接单 / 处理中 / 待验收 / 验收退回）',
      target: { kind: 'route', path: '/issues', query: { workOrder: 'open' } },
    },
    {
      key: 'structure_alarm',
      title: '结构预警',
      count: alarms,
      unit: '条事件',
      criteria: '预警事件中还没关闭的（待确认 / 处理中 / 恢复待确认），依据是传感器证据链',
      target: { kind: 'route', path: '/alarms', query: { scope: 'unclosed' } },
    },
  ]
}

export interface MaintenanceCalendarPlanHit {
  planId: string
  code: string
  name: string
  owner: string
  deviceId: string
  deviceName: string
}

export interface MaintenanceCalendarTaskHit {
  id: string
  taskNo: string
  status: MaintenanceTask['status']
  overdue: boolean
  daysLeft: number
  deviceName: string
  owner: string
}

/** 日历格子状态：已完成 / 待执行 / 逾期，外加"命中计划但还没生成任务"。 */
export type MaintenanceCalendarState = 'none' | 'planned' | 'pending' | 'overdue' | 'done'

export interface MaintenanceCalendarDay {
  dayKey: string
  /** 命中计划执行日的计划（只含启用中的计划，与任务生成口径一致） */
  plans: MaintenanceCalendarPlanHit[]
  /** 该天真实存在的任务（按执行时刻的本地日匹配，不新造日期） */
  tasks: MaintenanceCalendarTaskHit[]
  state: MaintenanceCalendarState
}

/**
 * 某天命中计划执行日的计划。
 * 停用计划不算：停用后不再生成任务，日历上标成执行日会让人白跑一趟。
 */
export function maintenanceDayPlanHits(input: MaintenanceDataInput, dayKey: string): MaintenanceCalendarPlanHit[] {
  const day = new Date(`${dayKey}T00:00:00`)
  if (!Number.isFinite(day.getTime())) return []
  const deviceNameOf = new Map(input.devices.map((row) => [row.id, row.name]))
  const hits: MaintenanceCalendarPlanHit[] = []
  for (const plan of input.plans) {
    if (!plan.enabled) continue
    if (maintenanceRunsOf(plan, day, day).length === 0) continue
    hits.push({
      planId: plan.id,
      code: plan.code,
      name: plan.name,
      owner: plan.owner,
      deviceId: plan.deviceId,
      deviceName: deviceNameOf.get(plan.deviceId) ?? '（设备档案已删除）',
    })
  }
  return hits
}

function calendarStateOf(plans: MaintenanceCalendarPlanHit[], tasks: MaintenanceCalendarTaskHit[]): MaintenanceCalendarState {
  if (tasks.length === 0) return plans.length === 0 ? 'none' : 'planned'
  if (tasks.some((row) => row.overdue)) return 'overdue'
  return tasks.every((row) => row.status === 'done') ? 'done' : 'pending'
}

/** 日历的一天：计划执行日 + 该天任务 + 格子状态。 */
export function maintenanceCalendarDayOf(input: MaintenanceDataInput, dayKey: string): MaintenanceCalendarDay {
  const plans = maintenanceDayPlanHits(input, dayKey)
  const rows = maintenanceTasksOnDay(input.tasks, dayKey)
  const tasks = rows.map((task) => {
    const state = maintenanceTaskState(task, input.todayKey, input.now)
    return {
      id: task.id,
      taskNo: task.taskNo,
      status: task.status,
      overdue: state.overdue,
      daysLeft: state.daysLeft,
      deviceName: task.snapshot.deviceName,
      owner: task.snapshot.owner,
    }
  })
  return { dayKey, plans, tasks, state: calendarStateOf(plans, tasks) }
}

/** 某月的每一天（1 号到月末），日期全部由年月推出，不由调用方补。 */
export function maintenanceCalendar(input: MaintenanceDataInput, year: number, month: number): MaintenanceCalendarDay[] {
  const lastDay = new Date(year, month, 0).getDate()
  const days: MaintenanceCalendarDay[] = []
  for (let day = 1; day <= lastDay; day += 1) {
    days.push(maintenanceCalendarDayOf(input, `${year}-${pad(month)}-${pad(day)}`))
  }
  return days
}

/**
 * 管理指标（V1-E）：**每项都写清定义、分子、分母、时间范围与不纳入条件**。
 *
 * 三条口径纪律：
 * ① 只统计**已经落库、可追溯**的数据，不在页面临时拼口径；
 * ② 拿不到判定依据的对象**不硬算** —— 已关闭但从未登记复查的问题无法判断是否按期，
 *    它进"不纳入"清单并如实计数，而不是当成按期或逾期；
 * ③ 分母为 0 时返回 `value: null`，页面显示"暂无数据"，**不显示 0% 或 100%**。
 */
import { localDayKey, maintenanceDaysLeft } from '@/core/maintenance/plan'
import { roundsOf } from '@/core/inspection/recheck'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'

/** 统计范围：按各对象的起始事件时间筛选（本地日，闭区间）；null 表示不限时间。 */
export interface MetricsRange {
  from: string
  to: string
}

export interface MetricsInput {
  events: AlarmEvent[]
  issues: InspectionIssue[]
  maintenanceTasks: MaintenanceTask[]
  /** 工单用于"事件是否已被处置"的追溯展示，不参与三项指标的分母 */
  workOrders: WorkOrder[]
  /** 测点 → 楼栋；事件只带测点，做楼栋筛选要靠它 */
  buildingOfPoint: Record<string, string>
  range: MetricsRange | null
  /** 楼栋筛选；null 表示全部楼栋 */
  buildingId: string | null
}

/** 不纳入统计的对象：给出原因与清单，避免"少了几个也不知道"。 */
export interface Exclusion {
  label: string
  count: number
  samples: string[]
}

export interface Indicator {
  key: string
  name: string
  /** 一句话定义（页面直接展示） */
  definition: string
  /** 分子说明与实际值 */
  numerator: { label: string; value: number }
  /** 分母说明与实际值 */
  denominator: { label: string; value: number }
  /** 展示口径：ratio 为百分比，hours 为小时数 */
  kind: 'ratio' | 'hours'
  /** 分母为 0 时为 null（页面显示"暂无数据"） */
  value: number | null
  /** 补充的稳健参考值（例如响应时长的中位数） */
  extra: string
  exclusions: Exclusion[]
}

const HOUR = 3_600_000

function dayOf(iso: string): string {
  return localDayKey(new Date(iso))
}

function inRange(iso: string, range: MetricsRange | null): boolean {
  if (range === null) return true
  const day = dayOf(iso)
  return day >= range.from && day <= range.to
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 事件是否属于筛选范围：按测点所属楼栋。 */
function inBuilding(buildingId: string | null, actual: string | null): boolean {
  if (buildingId === null) return true
  return actual === buildingId
}

/**
 * 事件的首次响应时刻：确认时间与"由该事件转出的最早问题创建时间"里更早的那个。
 * 只确认不处置、只转问题不确认都算已响应，两者都取最早，避免把处置时长算长。
 */
function firstResponseAt(event: AlarmEvent, issueTimes: string[]): string | null {
  const candidates = [...issueTimes, ...(event.acknowledgedAt === null ? [] : [event.acknowledgedAt])]
  if (candidates.length === 0) return null
  return candidates.sort()[0]
}

/** 指标的公共收尾：把分子分母组装成可展示结构。 */
function build(input: {
  key: string
  name: string
  definition: string
  kind: 'ratio' | 'hours'
  numerator: { label: string; value: number }
  denominator: { label: string; value: number }
  extra?: string
  exclusions?: Exclusion[]
}): Indicator {
  const value = input.denominator.value === 0 ? null : input.numerator.value / input.denominator.value
  return {
    key: input.key,
    name: input.name,
    definition: input.definition,
    numerator: input.numerator,
    denominator: input.denominator,
    kind: input.kind,
    value,
    extra: input.extra ?? '',
    exclusions: input.exclusions ?? [],
  }
}

/**
 * 指标一：预警响应时长（小时，分母为已响应事件数）。
 * 时间范围按事件产生时间；未确认且未转问题的事件进"未响应清单"，不进分母。
 */
export function responseDuration(input: MetricsInput): Indicator {
  const issuesByEvent = new Map<string, string[]>()
  for (const issue of input.issues) {
    if (issue.eventId === null) continue
    const list = issuesByEvent.get(issue.eventId) ?? []
    list.push(issue.createdAt)
    issuesByEvent.set(issue.eventId, list)
  }
  const durations: number[] = []
  const responsive: string[] = []
  const silent: string[] = []
  for (const event of input.events) {
    if (!inRange(event.openedAt, input.range)) continue
    if (!inBuilding(input.buildingId, input.buildingOfPoint[event.pointId] ?? null)) continue
    const response = firstResponseAt(event, issuesByEvent.get(event.id) ?? [])
    if (response === null) {
      silent.push(event.eventNo)
      continue
    }
    durations.push((new Date(response).getTime() - new Date(event.openedAt).getTime()) / HOUR)
    responsive.push(event.eventNo)
  }
  const total = durations.reduce((sum, value) => sum + value, 0)
  const medianText = durations.length === 0 ? '' : `中位数 ${median(durations).toFixed(1)} 小时（稳健参考）`
  return build({
    key: 'response',
    name: '预警响应时长',
    definition:
      '事件产生到**首次响应**的平均时长；首次响应取"人工确认"与"转出问题"中更早的那个时刻。时间范围按事件产生时间。',
    kind: 'hours',
    numerator: { label: '已响应事件的响应时长合计（小时）', value: Math.round(total * 10) / 10 },
    denominator: { label: '范围内已响应事件数', value: responsive.length },
    extra: medianText,
    exclusions: [
      {
        label: '未响应事件（既未确认、也没有转出问题）：无法计算响应时长，不进分母',
        count: silent.length,
        samples: silent.slice(0, 8),
      },
    ],
  })
}

/** 问题关闭时刻：取时间线里最后一条"关闭"动作，缺失时退回更新时间。 */
function closedAtOf(issue: InspectionIssue): string | null {
  const entries = issue.timeline.filter((row) => row.action.includes('关闭'))
  if (entries.length > 0) return entries[entries.length - 1].at
  return issue.status === 'closed' ? issue.updatedAt : null
}

/**
 * 指标二：问题按期闭环率。
 * 分母只含"已关闭且登记过复查"的问题 —— 未登记复查就没有目标日期，判定不了是否按期；
 * 这类问题进"不纳入"清单单独列出，不计入分子也不计入分母。
 */
export function issueClosureRate(input: MetricsInput): Indicator {
  const onTime: string[] = []
  const late: string[] = []
  const noRecheck: string[] = []
  const open: string[] = []
  for (const issue of input.issues) {
    if (!inBuilding(input.buildingId, issue.buildingId)) continue
    const closedAt = closedAtOf(issue)
    if (closedAt === null) {
      if (inRange(issue.createdAt, input.range)) open.push(issue.issueNo)
      continue
    }
    if (!inRange(closedAt, input.range)) continue
    const rounds = roundsOf(issue)
    const last = rounds.length === 0 ? undefined : rounds[rounds.length - 1]
    if (last === undefined || last.outcome === null) {
      noRecheck.push(issue.issueNo)
      continue
    }
    const due = `${last.dueDate}T23:59:59`
    if (new Date(closedAt).getTime() <= new Date(due).getTime()) onTime.push(issue.issueNo)
    else late.push(issue.issueNo)
  }
  const denominator = onTime.length + late.length
  return build({
    key: 'closure',
    name: '问题按期闭环率',
    definition:
      '**在最后登记的复查目标日期（含当天）之前关闭**的问题占比。时间范围按问题关闭时间。',
    kind: 'ratio',
    numerator: { label: '按期关闭的问题数', value: onTime.length },
    denominator: { label: '范围内已关闭且登记过复查的问题数', value: denominator },
    extra: late.length === 0 ? '' : `逾期关闭 ${late.length} 条：${late.slice(0, 8).join('、')}`,
    exclusions: [
      {
        label: '已关闭但从未登记复查：没有目标日期，判定不了是否按期，不进分子分母',
        count: noRecheck.length,
        samples: noRecheck.slice(0, 8),
      },
      {
        label: '范围内仍未关闭的问题（另列未闭环清单）',
        count: open.length,
        samples: open.slice(0, 8),
      },
    ],
  })
}

/** 复查轮次按期率：只统计已经给出结论的轮次。 */
function recheckOnTime(issues: InspectionIssue[], range: MetricsRange | null, buildingId: string | null) {
  const onTime: string[] = []
  const late: string[] = []
  const pending: string[] = []
  for (const issue of issues) {
    if (!inBuilding(buildingId, issue.buildingId)) continue
    const rounds = roundsOf(issue)
    for (let index = 0; index < rounds.length; index += 1) {
      const round = rounds[index]
      const label = `${issue.issueNo} 第 ${index + 1} 轮`
      if (round.outcome === null || round.outcomeAt === null) {
        if (inRange(round.at, range)) pending.push(label)
        continue
      }
      if (!inRange(round.outcomeAt, range)) continue
      const due = `${round.dueDate}T23:59:59`
      if (new Date(round.outcomeAt).getTime() <= new Date(due).getTime()) onTime.push(label)
      else late.push(label)
    }
  }
  return { onTime, late, pending }
}

/** 保养任务按期率：只统计已完成的任务。 */
function maintenanceOnTime(tasks: MaintenanceTask[], range: MetricsRange | null, buildingId: string | null) {
  const onTime: string[] = []
  const late: string[] = []
  const unfinished: string[] = []
  for (const task of tasks) {
    if (!inBuilding(buildingId, task.snapshot.buildingId)) continue
    const label = `${task.taskNo === '' ? task.id : task.taskNo}（${task.snapshot.deviceName}）`
    if (task.status !== 'done' || task.execution === null) {
      if (inRange(task.plannedAt, range)) unfinished.push(label)
      continue
    }
    if (!inRange(task.execution.at, range)) continue
    // 按"执行日 ≤ 计划执行日"判定：当日 23:59:59 前完成都算按期
    if (maintenanceDaysLeft(task, dayOf(task.execution.at)) >= 0) onTime.push(label)
    else late.push(label)
  }
  return { onTime, late, unfinished }
}

/**
 * 指标三：复查 / 保养按期完成率。
 * 两项合在一个指标里，是因为它们是同一句话的两个现场动作；分子分母分别列出，不混算。
 */
export function periodicCompletionRate(input: MetricsInput): Indicator {
  const recheck = recheckOnTime(input.issues, input.range, input.buildingId)
  const maintenance = maintenanceOnTime(input.maintenanceTasks, input.range, input.buildingId)
  const onTime = recheck.onTime.length + maintenance.onTime.length
  const total = onTime + recheck.late.length + maintenance.late.length
  const extra = [
    recheck.late.length + recheck.onTime.length === 0
      ? '复查：暂无已出结论的轮次'
      : `复查 ${recheck.onTime.length}/${recheck.onTime.length + recheck.late.length}`,
    maintenance.onTime.length + maintenance.late.length === 0
      ? '保养：暂无已完成任务'
      : `保养 ${maintenance.onTime.length}/${maintenance.onTime.length + maintenance.late.length}`,
  ].join('；')
  return build({
    key: 'periodic',
    name: '复查 / 保养按期完成率',
    definition:
      '**在目标日期（复查轮次的目标日期、保养任务的计划执行日）当天 23:59:59 前完成**的占比。复查按结论时间、保养按执行时间，都取本地日。',
    kind: 'ratio',
    numerator: { label: '按期完成的复查轮次 + 保养任务数', value: onTime },
    denominator: { label: '范围内已出结论的复查轮次 + 已完成保养任务数', value: total },
    extra,
    exclusions: [
      {
        label: '尚未给出结论的复查轮次（逾期与否另行提醒，不计入按期率）',
        count: recheck.pending.length,
        samples: recheck.pending.slice(0, 8),
      },
      {
        label: '范围内未完成的保养任务（另列逾期清单）',
        count: maintenance.unfinished.length,
        samples: maintenance.unfinished.slice(0, 8),
      },
    ],
  })
}

/** 三项指标一次算齐（页面按顺序展示）。 */
export function allIndicators(input: MetricsInput): Indicator[] {
  return [responseDuration(input), issueClosureRate(input), periodicCompletionRate(input)]
}

/**
 * 范围预设：近 7 天 / 近 30 天 / 本月 / 不限。
 * 以传入的"今天"为准（演示时钟），不读系统时间 —— 演示时钟被手动改过时，指标范围要跟着它走。
 */
export function rangeOf(preset: string, todayKey: string): MetricsRange | null {
  const [y, m, d] = todayKey.split('-').map((part) => Number.parseInt(part, 10))
  if (preset === 'all' || !Number.isFinite(y)) return null
  const today = new Date(y, m - 1, d)
  const startOfMonth = { from: localDayKey(new Date(y, m - 1, 1)), to: localDayKey(today) }
  if (preset === 'month') return startOfMonth
  if (preset === 'week') return { from: localDayKey(new Date(y, m - 1, d - 6)), to: localDayKey(today) }
  return { from: localDayKey(new Date(y, m - 1, d - 29)), to: localDayKey(today) }
}

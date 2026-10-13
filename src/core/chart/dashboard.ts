/**
 * 驾驶舱三张图的纯数据层。
 *
 * 入参是**结构化的只读行**（`AssistantSnapshot` 原样可传，见 `ChartInput`），
 * 因此这里不接触 Pinia、不补零、不臆造：算不出样本就返回空数组 + 可读的空态文案。
 * 三张图各自回答一个问题：
 *  ① 读数是在接近阈值，还是已经越线 —— 测点最近有效读数趋势 + 三级阈值线；
 *  ② 哪天触发多、当前还有多少未处置 —— 近 7 日预警事件柱状图（每条事件只计一次）；
 *  ③ 预警、派工、维修、验收卡在哪一步 —— 处置阶段平均耗时。
 */
import { hasNumericReadings, metricDef } from '@/types/catalog'
import type { PointFacts } from '@/core/rules'
import type { Baseline, MetricKey, MetricValueKey, MonitorRecord } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { MonitoringRule } from '@/types/rules'
import { buildTrendSeries, type TrendSeriesSpec } from './trend'
import type { TimeRange } from './range'

const DAY_MS = 86_400_000
/** 趋势图默认看最近 30 天，与监测趋势页的默认范围一致 */
export const READING_WINDOW_DAYS = 30
export const EVENT_WINDOW_DAYS = 7

/** 趋势图要用的测点字段；`PointRef` 与完整 `Point` 都能直接传。 */
export interface ChartPointFacts extends PointFacts {
  code: string
  name: string
  archived: boolean
}

/** 阶段耗时图要用的工单字段；与快照里的 `WorkOrderRef` 保持一致（前者 extend 自它）。 */
export interface WorkOrderFacts {
  id: string
  orderNo: string
  eventId: string | null
  pointId: string | null
  assignedAt: string | null
  submittedAt: string | null
  reviewedAt: string | null
}

/** 三张图共同的输入；直接把 `AssistantSnapshot` 传进来即可（结构兼容）。 */
export interface ChartInput {
  now: string
  points: ChartPointFacts[]
  records: MonitorRecord[]
  events: AlarmEvent[]
  rules: MonitoringRule[]
  baselines: Baseline[]
  workOrders: WorkOrderFacts[]
}

/* ------------------------------ ① 读数与阈值趋势 ------------------------------ */

export interface ChartDataPoint {
  t: number
  value: number
  /** 命中事件时的等级；没命中为 null（图上用深色点标出来） */
  eventLevel: 'yellow' | 'orange' | 'red' | null
  eventId: string | null
}

export interface ReadingLine {
  pointId: string
  pointCode: string
  name: string
  /** 按时间断开的线段：间隔过大处不连线（沿用监测趋势页的口径） */
  segments: ChartDataPoint[][]
  /** 最近一条有效读数，用于图例排序与提示 */
  latest: ChartDataPoint | null
}

export interface ReadingThreshold {
  level: 'yellow' | 'orange' | 'red'
  value: number
}

export interface ReadingTrendModel {
  metric: MetricKey | ''
  metricName: string
  fieldKey: MetricValueKey | ''
  fieldLabel: string
  unit: string
  digits: number
  lines: ReadingLine[]
  thresholds: ReadingThreshold[]
  /** 同筛选范围里属于别的指标、因单位不同没有混画的测点数 */
  otherMetricPoints: number
  /** 因存疑或无效被排除的有效性之外读数条数 */
  excludedReadings: number
  emptyText: string
}

const EMPTY_READING: ReadingTrendModel = {
  metric: '', metricName: '', fieldKey: '', fieldLabel: '', unit: '', digits: 2,
  lines: [], thresholds: [], otherMetricPoints: 0, excludedReadings: 0,
  emptyText: '暂无有效读数',
}

function timeOf(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : Number.NaN
}

/**
 * 时间窗口的右端：取"时钟刻度"与**当前筛选范围内**数据最新时刻的较大者。
 *
 * 两个坑都在这里：
 * ① 演示时钟停在页面载入那一刻，载入之后写入的数据用真实时刻、比时钟晚，
 *    直接以时钟为右端会把这几分钟的新数据切掉，看起来像"写入后图表不刷新"；
 * ② 取样必须限定在**本次筛选的测点**上 —— 用全量记录定窗口的话，
 *    别的楼栋刚录了一条新数据，就会把当前筛选这张图推进空态。
 */
function windowEndOf(clockIso: string, stamps: string[]): number {
  const clock = timeOf(clockIso)
  const end = Number.isFinite(clock) ? clock : Date.now()
  let latest = end
  for (const stamp of stamps) {
    const t = timeOf(stamp)
    if (Number.isFinite(t) && t > latest) latest = t
  }
  return latest
}

/** 范围内有数值读数的在册传感器测点 */
export function sensorPointsOf(input: ChartInput, pointIds: string[]): ChartPointFacts[] {
  const scope = new Set(pointIds)
  return input.points.filter(
    (row) => scope.has(row.id) && !row.archived && hasNumericReadings(row.metric),
  )
}

/** 不指定指标时，选范围内测点最多的那个指标（并列时按指标名稳定排序） */
export function dominantMetricOf(points: ChartPointFacts[]): MetricKey | '' {
  const counts = new Map<MetricKey, number>()
  for (const row of points) counts.set(row.metric, (counts.get(row.metric) ?? 0) + 1)
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || metricDef(a[0]).name.localeCompare(metricDef(b[0]).name),
  )
  return ranked[0]?.[0] ?? ''
}

function thresholdRowsOf(lines: { level: 'yellow' | 'orange' | 'red'; value: number }[]): ReadingThreshold[] {
  const seen = new Map<string, ReadingThreshold>()
  for (const row of lines) seen.set(`${row.level}:${row.value}`, { level: row.level, value: row.value })
  return [...seen.values()].sort((a, b) => a.value - b.value)
}

function readingLineOf(
  input: ChartInput,
  point: ChartPointFacts,
  spec: TrendSeriesSpec,
  from: number,
  to: number,
): { line: ReadingLine | null; thresholds: ReadingThreshold[]; excluded: number } {
  const rows = input.records.filter((row) => row.pointId === point.id && Number.isFinite(row.values[spec.key]))
  const inWindow = rows.filter((row) => {
    const t = timeOf(row.sampleTime)
    return Number.isFinite(t) && t >= from && t <= to
  })
  const valid = inWindow.filter((row) => row.quality === 'valid')
  const excluded = inWindow.length - valid.length
  if (valid.length === 0) return { line: null, thresholds: [], excluded }
  const series = buildTrendSeries({
    point, records: valid,
    baselines: input.baselines.filter((row) => row.pointId === point.id),
    events: input.events.filter((row) => row.pointId === point.id),
    rules: input.rules, series: spec, from, to,
  })
  if (series.points.length === 0) return { line: null, thresholds: [], excluded }
  // 振动事件由 RMS 判定；峰值曲线不能把同一记录上的事件误标为“峰值越线”。
  const rmsOnly = point.metric === 'vibration' && spec.key === 'accelPeak'
  const asPoint = (row: { t: number; value: number; eventLevel: ChartDataPoint['eventLevel']; eventId: string | null }): ChartDataPoint => ({
    t: row.t, value: row.value, eventLevel: rmsOnly ? null : row.eventLevel, eventId: rmsOnly ? null : row.eventId,
  })
  return {
    line: {
      pointId: point.id, pointCode: point.code, name: point.name,
      segments: series.lineSegments.map((segment) => segment.map(asPoint)),
      latest: asPoint(series.points[series.points.length - 1]),
    },
    thresholds: rmsOnly ? [] : series.thresholdLines.map((row) => ({ level: row.level, value: row.value })),
    excluded,
  }
}

/**
 * 测点最近有效读数趋势 + 三级阈值线。
 *
 * 只画**同一指标**的测点：不同指标单位不同，混在一根轴上会把裂缝的毫米和振动的 m/s² 画到一起。
 * 同范围的其余指标测点用 `otherMetricPoints` 如实报出，不隐藏也不硬凑。
 */
export function buildReadingTrend(
  input: ChartInput,
  pointIds: string[],
  metric: MetricKey | '',
  fieldKey: MetricValueKey | '' = '',
  range?: TimeRange,
): ReadingTrendModel {
  const scoped = sensorPointsOf(input, pointIds)
  const chosen = metric !== '' ? metric : dominantMetricOf(scoped)
  if (chosen === '') return EMPTY_READING
  const def = metricDef(chosen)
  const field = def.fields.find((row) => row.key === fieldKey) ?? def.fields[0]
  if (field === undefined) return EMPTY_READING

  const spec: TrendSeriesSpec = { key: field.key, label: field.label, unit: field.unit, digits: field.digits }
  const sameMetric = scoped.filter((row) => row.metric === chosen)
  const sameMetricIds = new Set(sameMetric.map((row) => row.id))
  /*
   * 定锚只用**有效**读数：画出来的本来就只有有效点，若让一条很晚的无效/存疑记录当锚点，
   * 窗口右端会被推到那条记录上，较早的有效曲线整段掉出窗口 —— 表现为"曲线突然空了"，
   * 而输入数据其实没变。窗口与画点用同一口径（quality === 'valid'）。
   */
  const to = range ? range.toExclusive - 1 : windowEndOf(input.now, input.records
    .filter((row) => sameMetricIds.has(row.pointId) && row.quality === 'valid' && Number.isFinite(row.values[field.key]))
    .map((row) => row.sampleTime))
  const from = range?.from ?? to - READING_WINDOW_DAYS * DAY_MS
  const lines: ReadingLine[] = []
  const thresholds = new Map<string, ReadingThreshold>()
  let excluded = 0

  for (const point of sameMetric) {
    const row = readingLineOf(input, point, spec, from, to)
    excluded += row.excluded
    if (row.line !== null) lines.push(row.line)
    for (const threshold of row.thresholds) {
      thresholds.set(`${threshold.level}:${threshold.value}`, threshold)
    }
  }
  lines.sort((a, b) => a.pointCode.localeCompare(b.pointCode))

  return {
    metric: chosen,
    metricName: def.name,
    fieldKey: field.key,
    fieldLabel: field.label,
    unit: field.unit,
    digits: field.digits,
    lines,
    // 相对基准可能因测点而异；多测点图不把某一点的阈值冒充全体共同阈值。
    thresholds: lines.length === 1 ? thresholdRowsOf([...thresholds.values()]) : [],
    otherMetricPoints: scoped.length - sameMetric.length,
    excludedReadings: excluded,
    emptyText: '暂无有效读数',
  }
}

/* ------------------------------ ② 近 7 日预警事件 ------------------------------ */

export interface EventDayBar {
  /** 本地日期键 YYYY-MM-DD */
  key: string
  /** 轴上显示 MM-DD */
  label: string
  count: number
  openCount: number
  /** 当天的事件编号，按时间倒序；点柱状图时按这个跳转 */
  eventIds: string[]
  eventNos: string[]
}

export interface EventHistoryModel {
  days: EventDayBar[]
  total: number
  openTotal: number
  /** 窗口内有事件但测点已不在筛选范围内的条数（如实报出，不悄悄丢掉） */
  outOfScope: number
  emptyText: string
}

function localDayKey(t: number): string {
  const date = new Date(t)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 未关闭：不是 closed —— 与异常队列、问筑瞳用的是同一个判断。 */
function isOpen(event: AlarmEvent): boolean {
  return event.status !== 'closed'
}

/**
 * 近 N 日预警事件柱状图。
 *
 * **按事件去重**：一条事件只在它的生成日计一次，不按证据条数或升级次数重复计数。
 * 时间轴上没有事件的那天显示 0（那是事实，不是补出来的数）。
 */
export function buildEventHistory(input: ChartInput, pointIds: string[], days = EVENT_WINDOW_DAYS): EventHistoryModel {
  const scope = new Set(pointIds)
  const end = windowEndOf(
    input.now,
    input.events.filter((row) => scope.has(row.pointId)).map((row) => row.openedAt),
  )
  const start = end - (days - 1) * DAY_MS
  const buckets = new Map<string, EventDayBar>()
  for (let i = 0; i < days; i += 1) {
    const t = start + i * DAY_MS
    const key = localDayKey(t)
    buckets.set(key, { key, label: key.slice(5), count: 0, openCount: 0, eventIds: [], eventNos: [] })
  }

  let total = 0
  let openTotal = 0
  let outOfScope = 0
  for (const event of input.events) {
    const t = timeOf(event.openedAt)
    if (!Number.isFinite(t) || t < start || t > end) continue
    if (!scope.has(event.pointId)) { outOfScope += 1; continue }
    const bucket = buckets.get(localDayKey(t))
    if (bucket === undefined) continue
    bucket.count += 1
    if (isOpen(event)) { bucket.openCount += 1; openTotal += 1 }
    bucket.eventIds.push(event.id)
    bucket.eventNos.push(event.eventNo)
    total += 1
  }
  for (const bucket of buckets.values()) {
    const paired = bucket.eventIds
      .map((id, i) => ({ id, no: bucket.eventNos[i] ?? '' }))
      .sort((a, b) => b.no.localeCompare(a.no))
    bucket.eventIds = paired.map((row) => row.id)
    bucket.eventNos = paired.map((row) => row.no)
  }

  return { days: [...buckets.values()], total, openTotal, outOfScope, emptyText: '暂无事件' }
}

/* ------------------------------ ③ 处置阶段耗时 ------------------------------ */

export type StageKey = 'open_to_assign' | 'assign_to_submit' | 'submit_to_review'

export interface StageDuration {
  key: StageKey
  label: string
  /** 平均小时数；没有可算样本时为 null —— 不画 0，也不拿 0 冒充 */
  hours: number | null
  /** 参与平均的条数 */
  count: number
}

export interface StageDurationModel {
  stages: StageDuration[]
  /** 卡在各阶段之前的条数（未派工 / 未完工提交 / 未验收），按阶段分别报 */
  pending: Record<'assign' | 'submit' | 'review', number>
  /** 时间倒挂（后一步早于前一步）而无法计入平均的条数 */
  inconsistent: number
  /** 纳入统计的工单条数（测点在当前筛选范围内） */
  total: number
  emptyText: string
}

function hoursBetween(fromIso: string, toIso: string): number | null {
  const from = timeOf(fromIso)
  const to = timeOf(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const gap = to - from
  if (gap < 0) return null
  return gap / 3_600_000
}

function average(rows: number[]): number | null {
  if (rows.length === 0) return null
  const sum = rows.reduce((acc, row) => acc + row, 0)
  return Math.round((sum / rows.length) * 10) / 10
}

/**
 * 处置阶段平均耗时：事件生成 → 派工 → 完工提交 → 验收。
 *
 * 只统计**能连起来的那些段**：没派工的工单不计入派工段、没验收的不计入验收段，
 * 并在 `pending` 里如实报出卡住的条数 —— 这样"卡在哪一步"看的是缺口，不是把缺失当 0 拉低平均。
 */
export function buildStageDurations(input: ChartInput, pointIds: string[]): StageDurationModel {
  const scope = new Set(pointIds)
  const orders = input.workOrders.filter((row) => row.pointId !== null && scope.has(row.pointId))
  const eventById = new Map(input.events.map((row) => [row.id, row]))
  const openToAssign: number[] = []
  const assignToSubmit: number[] = []
  const submitToReview: number[] = []
  const pending = { assign: 0, submit: 0, review: 0 }
  let inconsistent = 0

  for (const order of orders) {
    const event = order.eventId === null ? undefined : eventById.get(order.eventId)
    if (order.assignedAt === null) { pending.assign += 1 } else if (event !== undefined) {
      const gap = hoursBetween(event.openedAt, order.assignedAt)
      if (gap === null) inconsistent += 1
      else openToAssign.push(gap)
    }
    if (order.assignedAt !== null && order.submittedAt === null) pending.submit += 1
    if (order.assignedAt !== null && order.submittedAt !== null) {
      const gap = hoursBetween(order.assignedAt, order.submittedAt)
      if (gap === null) inconsistent += 1
      else assignToSubmit.push(gap)
    }
    if (order.submittedAt !== null && order.reviewedAt === null) pending.review += 1
    if (order.submittedAt !== null && order.reviewedAt !== null) {
      const gap = hoursBetween(order.submittedAt, order.reviewedAt)
      if (gap === null) inconsistent += 1
      else submitToReview.push(gap)
    }
  }

  return {
    stages: [
      { key: 'open_to_assign', label: '事件生成 → 派工', hours: average(openToAssign), count: openToAssign.length },
      { key: 'assign_to_submit', label: '派工 → 完工提交', hours: average(assignToSubmit), count: assignToSubmit.length },
      { key: 'submit_to_review', label: '完工提交 → 验收', hours: average(submitToReview), count: submitToReview.length },
    ],
    pending,
    inconsistent,
    total: orders.length,
    emptyText: '暂无工单',
  }
}

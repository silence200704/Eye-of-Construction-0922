/**
 * 单测点单指标的趋势序列构建。
 *
 * 图表只呈现"一条数据线 + 基准线 + 三级阈值线 + 事件节点 + 修订标记"，
 * 所有判定相关的事实都取自记录自己的基准快照与事件证据，不在图表层重算规则 ——
 * 这样图上看到的分级与预警中心里看到的事件必然一致。
 *
 * 三条口径：
 * ① 只取采样时间落在所选范围内的记录，未来记录不参与；
 * ② 基准线按版本生效时间分段，阈值线随基准分段平移（绝对判定指标不分段）；
 * ③ 已被修订替代的记录单独成组，不混进有效曲线。
 */
import type { Baseline, MetricValueKey, MonitorRecord } from '@/types/domain'
import type { DataState, MonitoringRule, RuleThresholds } from '@/types/rules'
import type { AlarmEvent, EventLevel } from '@/types/events'
import { baselineAtTime, levelOfRecord, ruleForPoint, rulesForPoint, type PointFacts } from '@/core/rules'

export interface TrendSeriesSpec {
  key: MetricValueKey
  label: string
  unit: string
  digits: number
}

export interface TrendPoint {
  recordId: string
  recordNo: string
  sampleTime: string
  t: number
  value: number
  /** 该点的数值分级，与列表页口径一致 */
  state: DataState | null
  baselineVersion: number | null
  baselineValue: number | null
  /** 命中的事件 */
  eventId: string | null
  eventNo: string
  eventLevel: EventLevel | null
  /** 该点判定时生效的规则版本 */
  ruleVersion: string | null
  /** 该点是否让事件升过一次级 */
  upgraded: boolean
  /** 修订次数，大于 0 表示被改过 */
  revision: number
}

export interface BaselineSegment {
  fromT: number
  toT: number
  value: number
  version: number
  effectiveFrom: string
}

export interface ThresholdLine {
  level: 'yellow' | 'orange' | 'red'
  value: number
  fromT: number
  toT: number
  /** 该段生效的规则版本，换版处阈值线也会断开 */
  ruleVersion: string
}

/** 规则与基准按时间切片后的结果：阈值线按这个分段绘制。 */
export interface RuleSegment {
  fromT: number
  toT: number
  ruleCode: string
  ruleVersion: string
  thresholds: RuleThresholds | null
  /** 该段规则的判定口径：相对基准（point）还是绝对判定（none / fixed） */
  baselineSource: MonitoringRule['baselineSource']
  /** 相对基准的指标：该段生效的基准值 */
  baselineValue: number | null
}

/**
 * 判定口径。
 * 只看本测点、本时间范围内适用的规则分段 —— 规则表里四类指标同表存放，
 * 拿全表判断会把裂缝规则的"相对基准"口径安到振动测点的图上。
 */
export type TrendMode = 'relative' | 'absolute' | 'mixed' | 'none'

export interface TrendSeries {
  series: TrendSeriesSpec
  points: TrendPoint[]
  /** 数据线的分段：间隔过大的地方断开，不用直线跨越没有测量的时段 */
  lineSegments: TrendPoint[][]
  supersededPoints: TrendPoint[]
  baselineSegments: BaselineSegment[]
  thresholdLines: ThresholdLine[]
  /** 规则与基准的联合分段；段数大于 1 说明规则或基准换过版 */
  ruleSegments: RuleSegment[]
  thresholds: RuleThresholds | null
  /** 本测点在本时间范围内的判定口径；换版处口径变化时为 mixed */
  mode: TrendMode
  /** 图上出现过的规则版本，按时间先后 */
  ruleVersions: string[]
}

export interface TrendInput {
  point: PointFacts
  records: MonitorRecord[]
  baselines: Baseline[]
  events: AlarmEvent[]
  /** 该测点的全部规则版本；每条记录按自己的采样时间取当时生效的版本 */
  rules: MonitoringRule[]
  series: TrendSeriesSpec
  /** 时间范围（毫秒时间戳，闭区间） */
  from: number
  to: number
}

function valueOf(record: MonitorRecord, key: MetricValueKey): number | null {
  const value = record.values[key]
  return value === undefined || value === null || !Number.isFinite(value) ? null : value
}

/** 已被修订替代的记录编号：出现在任一事件的"已替代证据"里。 */
function supersededIds(events: AlarmEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    for (const item of event.supersededEvidences ?? []) ids.add(item.evidence.recordId)
  }
  return ids
}

/** 记录 → 它所在事件的编号、等级与是否触发过升级。 */
function eventIndex(events: AlarmEvent[]): Map<string, { eventId: string; eventNo: string; level: EventLevel; upgraded: boolean }> {
  const map = new Map<string, { eventId: string; eventNo: string; level: EventLevel; upgraded: boolean }>()
  for (const event of events) {
    const upgradedRecords = new Set(event.upgrades.map((item) => item.recordNo))
    for (const evidence of event.evidences) {
      map.set(evidence.recordId, {
        eventId: event.id,
        eventNo: event.eventNo,
        level: evidence.level,
        upgraded: upgradedRecords.has(evidence.recordNo),
      })
    }
  }
  return map
}

/**
 * 基准分段：在所选时间范围内按各版本的生效时间切成若干段，
 * 每段用该段起点实际生效的基准值。基准换版的地方就是分段点。
 */
export function buildBaselineSegments(
  baselines: Baseline[],
  key: MetricValueKey,
  from: number,
  to: number,
): BaselineSegment[] {
  const rows = baselines
    .filter((row) => new Date(row.effectiveFrom).getTime() <= to && row.values[key] !== undefined)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  if (rows.length === 0) return []

  const boundaries = new Set<number>([from, to])
  for (const row of rows) {
    const start = new Date(row.effectiveFrom).getTime()
    if (start > from && start < to) boundaries.add(start)
  }
  const sorted = [...boundaries].sort((a, b) => a - b)

  const out: BaselineSegment[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]
    const end = sorted[index + 1]
    // 该段起点实际生效的基准：生效时间晚于段起点的版本不算
    const applicable = rows.filter((row) => new Date(row.effectiveFrom).getTime() <= start)
    const active = applicable.length === 0 ? undefined : applicable[applicable.length - 1]
    const value = active?.values[key]
    if (active === undefined || value === undefined) continue
    out.push({ fromT: start, toT: end, value, version: active.version, effectiveFrom: active.effectiveFrom })
  }
  return out
}

/**
 * 规则与基准的联合分段。
 *
 * 切点 = 规则生效时间与基准生效时间的并集：只要其中任何一个换版，阈值线就在这里断开。
 * 每段记录该段生效的规则版本与该段生效的基准值，阈值线按段绘制，
 * 因此图表、事件证据与历史记录对同一条数据的解释是同一个版本。
 */
export function buildRuleSegments(input: {
  rules: MonitoringRule[]
  baselines: Baseline[]
  point: PointFacts
  key: MetricValueKey
  from: number
  to: number
}): RuleSegment[] {
  /*
   * 只取适用本测点的规则版本：指标一致、落在规则的楼栋/测点范围内。
   * 规则表里四类指标同表且同一天生效，不过滤就会把别条规则的阈值画到这张图上。
   */
  const ruleRows = rulesForPoint(input.rules, input.point).filter(
    (row) => new Date(row.effectiveFrom).getTime() <= input.to,
  )
  const baselineRows = input.baselines
    .filter((row) => new Date(row.effectiveFrom).getTime() <= input.to && row.values[input.key] !== undefined)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

  const boundaries = new Set<number>([input.from, input.to])
  for (const row of ruleRows) {
    const t = new Date(row.effectiveFrom).getTime()
    if (t > input.from && t < input.to) boundaries.add(t)
  }
  for (const row of baselineRows) {
    const t = new Date(row.effectiveFrom).getTime()
    if (t > input.from && t < input.to) boundaries.add(t)
  }
  const sorted = [...boundaries].sort((a, b) => a - b)

  const out: RuleSegment[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]
    const end = sorted[index + 1]
    const rule = lastEffective(ruleRows, start)
    if (rule === undefined) continue
    const baseline = lastEffective(baselineRows, start)
    out.push({
      fromT: start,
      toT: end,
      ruleCode: rule.code,
      ruleVersion: rule.version,
      thresholds: rule.thresholds === null ? null : { ...rule.thresholds },
      baselineSource: rule.baselineSource,
      baselineValue: rule.baselineSource === 'point' ? (baseline?.values[input.key] ?? null) : null,
    })
  }
  return out
}

/** 最后一个分段的阈值（没有分段时为 null）；图例按它决定是否列三级阈值。 */
function lastThresholds(segments: RuleSegment[]): RuleThresholds | null {
  if (segments.length === 0) return null
  return segments[segments.length - 1].thresholds
}

/** 分段里的判定口径：全是相对基准 → relative，全是绝对判定 → absolute，混用 → mixed，无规则 → none。 */
export function modeOfSegments(segments: RuleSegment[]): TrendMode {
  if (segments.length === 0) return 'none'
  const relative = segments.some((row) => row.baselineSource === 'point')
  const absolute = segments.some((row) => row.baselineSource !== 'point')
  if (relative && absolute) return 'mixed'
  return relative ? 'relative' : 'absolute'
}

/** 生效时间不晚于给定时刻的最后一条版本。 */
function lastEffective<T extends { effectiveFrom: string }>(rows: T[], at: number): T | undefined {
  let found: T | undefined
  for (const row of rows) {
    if (new Date(row.effectiveFrom).getTime() <= at) found = row
  }
  return found
}

/** 阈值线：相对基准的指标随基准分段平移，绝对判定指标是水平线；规则换版处一律断开。 */
export function buildThresholdLines(segments: RuleSegment[]): ThresholdLine[] {
  const levels: ('yellow' | 'orange' | 'red')[] = ['yellow', 'orange', 'red']
  const out: ThresholdLine[] = []
  for (const segment of segments) {
    if (segment.thresholds === null) continue
    for (const level of levels) {
      const base = segment.baselineValue ?? 0
      out.push({
        level,
        value: Math.round((base + segment.thresholds[level]) * 1e6) / 1e6,
        fromT: segment.fromT,
        toT: segment.toT,
        ruleVersion: segment.ruleVersion,
      })
    }
  }
  return out
}

/**
 * 把点按间隔切成若干段。
 * 相邻记录间隔明显大于常规采样节奏时断开：一段直线跨越几天没有测量的时间，
 * 会让人以为期间数据是连续变化的。
 */
export function splitByGap(points: TrendPoint[]): TrendPoint[][] {
  if (points.length <= 1) return points.length === 0 ? [] : [points]
  const gaps: number[] = []
  for (let index = 1; index < points.length; index += 1) gaps.push(points[index].t - points[index - 1].t)
  const sorted = [...gaps].sort((a, b) => a - b)
  // 取"下中位数"：只有两个间隔时不会被那个大间隔带偏
  const typical = sorted[Math.floor((sorted.length - 1) / 2)]
  const span = points[points.length - 1].t - points[0].t
  /*
   * 断开阈值取三者最大：
   * 常规间隔的 4 倍（相对节奏）、整个时间跨度的四分之一（相对视野）、1 小时（绝对下限）。
   * 只看其中任何一个都会出问题：只看间隔在样本少时被大间隔带偏，
   * 只看跨度会把分钟级密集采样里的正常停顿误判成中断。
   */
  const limit = Math.max(typical * 4, span * 0.25, 60 * 60_000)

  const segments: TrendPoint[][] = [[points[0]]]
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].t - points[index - 1].t > limit) segments.push([])
    segments[segments.length - 1].push(points[index])
  }
  return segments
}

export function buildTrendSeries(input: TrendInput): TrendSeries {
  const superseded = supersededIds(input.events)
  const byRecord = eventIndex(input.events)

  const points: TrendPoint[] = []
  const supersededPoints: TrendPoint[] = []

  for (const record of input.records) {
    if (record.pointId !== input.point.id) continue
    const value = valueOf(record, input.series.key)
    if (value === null) continue
    const t = new Date(record.sampleTime).getTime()
    // ① 只取范围内的记录，未来记录不参与
    if (t < input.from || t > input.to) continue

    const baseline = baselineAtTime(input.baselines, input.point.id, record.sampleTime)
    // 每条记录按自己的采样时间取当时生效的规则版本，与事件证据的解释保持一致
    const effectiveRule = ruleForPoint(input.rules, input.point, record.sampleTime)
    const hit = byRecord.get(record.id)
    const point: TrendPoint = {
      recordId: record.id,
      recordNo: record.recordNo,
      sampleTime: record.sampleTime,
      t,
      value,
      state: effectiveRule === undefined ? null : levelOfRecord(effectiveRule, record),
      ruleVersion: effectiveRule?.version ?? null,
      baselineVersion: baseline?.version ?? record.baselineVersion,
      baselineValue: record.baselineValues === null ? null : Object.values(record.baselineValues).find((v) => typeof v === 'number') ?? null,
      eventId: hit?.eventId ?? null,
      eventNo: hit?.eventNo ?? '',
      eventLevel: hit?.level ?? null,
      upgraded: hit?.upgraded ?? false,
      revision: record.revision,
    }
    // ③ 已替代的记录单独成组
    if (superseded.has(record.id)) supersededPoints.push(point)
    else points.push(point)
  }

  points.sort((a, b) => a.t - b.t)
  supersededPoints.sort((a, b) => a.t - b.t)

  // ② 规则与基准联合分段：任一方换版都会在这里断开阈值线
  const ruleSegments = buildRuleSegments({
    rules: input.rules,
    baselines: input.baselines,
    point: input.point,
    key: input.series.key,
    from: input.from,
    to: input.to,
  })
  /*
   * 口径与阈值都从"本测点适用规则的分段"里推：
   * relative 决定是否画基准线与"基准 + 阈值"的说明，thresholds 决定图例是否列三级阈值。
   * 两者都必须只看本测点，否则裂缝规则会把振动图描述成相对基准判定。
   */
  const mode = modeOfSegments(ruleSegments)
  const segments = mode === 'relative' || mode === 'mixed'
    ? buildBaselineSegments(input.baselines, input.series.key, input.from, input.to)
    : []

  return {
    series: input.series,
    points,
    lineSegments: splitByGap(points),
    supersededPoints,
    baselineSegments: segments,
    thresholdLines: buildThresholdLines(ruleSegments),
    ruleSegments,
    thresholds: lastThresholds(ruleSegments),
    mode,
    ruleVersions: [...new Set(ruleSegments.map((row) => row.ruleVersion))],
  }
}

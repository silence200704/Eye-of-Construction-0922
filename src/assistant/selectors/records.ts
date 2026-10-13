/**
 * 读数选择器。
 *
 * 核心纪律：**"最新一条" ≠ "最新有效一条"**。
 * store 的 `latestOfPoint` 按采样时间取最后一条，那条可能是存疑或无效记录；
 * 这里专门按 `quality === 'valid'` 选，并且把"最新一条到底是什么质量"单独带出来，
 * 好让回答能解释"为什么没有可用读数"，而不是含糊地说一句"没有数据"。
 */
import { fmtDelta, fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import { BACKFILL_THRESHOLD_MINUTES, metricDef } from '@/types/catalog'
import type { MetricKey, MetricValues, MonitorRecord } from '@/types/domain'
import type { AskFact, AskTiming, ReadingFreshness } from '../types'

/**
 * 读数新鲜度窗口（分钟）。
 *
 * 复用补录判定阈值：演示里"一条数据离现在多远算近"只有一套约定，
 * 两处各定一套迟早出现"页面说补录、助手说实时"。这是演示约定，不是设备心跳超时标准。
 */
export const READING_FRESH_MINUTES = BACKFILL_THRESHOLD_MINUTES

/**
 * 记录排序：采样时间优先，同一采样时刻再按录入时间、最后按记录号。
 *
 * 同一采样时刻出现两条记录是真会发生的（一条有效、一条被判无效），
 * 只按采样时间排会让"最新一条是哪条"取决于数据库返回顺序 —— 那种不确定会一路传到回答里。
 */
function compareRecords(a: MonitorRecord, b: MonitorRecord): number {
  const bySample = a.sampleTime.localeCompare(b.sampleTime)
  if (bySample !== 0) return bySample
  const byEntered = a.enteredAt.localeCompare(b.enteredAt)
  return byEntered !== 0 ? byEntered : a.recordNo.localeCompare(b.recordNo)
}

/** 该测点的全部记录，按采样时间升序。 */
export function recordsOfPoint(records: MonitorRecord[], pointId: string): MonitorRecord[] {
  return records.filter((row) => row.pointId === pointId).sort(compareRecords)
}

/** 最新一条记录（不论质量）：用来解释"为什么没有可用读数"。 */
export function latestAnyRecord(records: MonitorRecord[], pointId: string): MonitorRecord | null {
  const list = recordsOfPoint(records, pointId)
  return list.length === 0 ? null : list[list.length - 1]
}

/**
 * 最新有效记录：只认 `quality === 'valid'`。
 * 采样时间相同的情况下后录入的胜出（同一采样时刻的修订结果）。
 */
export function latestValidRecord(records: MonitorRecord[], pointId: string): MonitorRecord | null {
  const usable = recordsOfPoint(records, pointId).filter((row) => row.quality === 'valid')
  return usable.length === 0 ? null : usable[usable.length - 1]
}

function minutesBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN
  return (to - from) / 60_000
}

/** 读数新鲜度：只描述数据离现在多远，**不代表设备在线与否**。 */
export function freshnessOf(sampleTime: string | null, now: string): ReadingFreshness {
  if (sampleTime === null) return 'none'
  const gap = minutesBetween(sampleTime, now)
  if (!Number.isFinite(gap)) return 'none'
  return Math.abs(gap) <= READING_FRESH_MINUTES ? 'current' : 'stale'
}

/** 间隔的中文说法：分钟 / 小时 / 天，避免"距今 14523 分钟"。看板与回答共用这一处措辞。 */
export function humanGap(fromIso: string, nowIso: string): string {
  const gap = minutesBetween(fromIso, nowIso)
  if (!Number.isFinite(gap)) return '时间不可解析'
  const ahead = gap < 0
  const abs = Math.abs(gap)
  const text = abs < 60 ? `${Math.round(abs)} 分钟` : abs < 60 * 48 ? `${(abs / 60).toFixed(1)} 小时` : `${(abs / 1440).toFixed(1)} 天`
  return ahead ? `晚于当前刻度约 ${text}` : `距今约 ${text}`
}

/**
 * 新鲜度的中文说明。
 *
 * 措辞刻意中性：这里只说"这个采样时间离现在多远"。
 * 它既可能描述一条有效读数，也可能描述一条被跳过的存疑记录，
 * 写成"最近有效读数"就会在后者上变成一句假话 —— 哪条记录有效由单点回答自己讲清楚。
 */
function freshnessLabelOf(sampleTime: string | null, now: string): string {
  const freshness = freshnessOf(sampleTime, now)
  if (freshness === 'none' || sampleTime === null) return '本机没有该测点的读数记录'
  const at = formatDateTime(sampleTime)
  if (freshness === 'current') return `采样时间 ${at}，处于近 ${READING_FRESH_MINUTES} 分钟内`
  return `采样时间 ${at}，已 ${humanGap(sampleTime, now)}；本机没有设备心跳，据此只能判断数据偏旧，不能判断设备离线`
}

/** 采样时间与录入时间分列，并带上补录、修订与新鲜度说明。 */
export function timingOf(record: MonitorRecord, now: string): AskTiming {
  return {
    sampleTime: record.sampleTime,
    enteredAt: record.enteredAt,
    isBackfill: record.isBackfill,
    revision: record.revision,
    freshness: freshnessOf(record.sampleTime, now),
    freshnessLabel: freshnessLabelOf(record.sampleTime, now),
  }
}

/** 关键数值：按指标定义取值与位数，缺项不补零。 */
export function factsOf(values: MetricValues, metric: MetricKey): AskFact[] {
  return metricDef(metric).fields.flatMap((field) => {
    const raw = values[field.key]
    if (raw === undefined) return []
    return [{ label: field.label, value: fmtNumber(raw, field.digits), unit: field.unit }]
  })
}

/** 相对基准的变化量：基准快照取自记录本身（录入当时的那一版），不是当前基准。 */
export function deltasOf(values: MetricValues, baseline: MetricValues | null, metric: MetricKey): AskFact[] {
  return metricDef(metric).deltas(values, baseline).map((item) => ({
    label: item.label,
    value: fmtDelta(item.value, item.digits),
    unit: item.unit,
  }))
}

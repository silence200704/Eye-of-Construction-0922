/** 把监测趋势页的同一条有效曲线裁成回答内的小图快照。 */
import { buildTrendSeries } from '@/core/chart/trend'
import { metricDef } from '@/types/catalog'
import type { AssistantSnapshot } from '../selectors'
import type { PointRef } from '../resolve'
import type { AskPreview } from '../types'

export function pointTrendPreview(snapshot: AssistantSnapshot, point: PointRef): AskPreview | null {
  const field = metricDef(point.metric).fields[0]
  if (field === undefined) return null
  const valid = snapshot.records.filter((row) => row.pointId === point.id && row.quality === 'valid')
  if (valid.length === 0) return null
  const stamps = valid.map((row) => Date.parse(row.sampleTime)).filter(Number.isFinite)
  if (stamps.length === 0) return null
  const from = Math.min(...stamps)
  const to = Math.max(...stamps)
  const trend = buildTrendSeries({
    point, records: valid, baselines: snapshot.baselines, events: snapshot.events,
    rules: snapshot.rules, series: field, from, to: Math.max(to, from + 1),
  })
  const samples = trend.lineSegments.map((segment) => segment.map((row) => ({
    recordId: row.recordId, sampleTime: row.sampleTime, value: row.value,
  }))).filter((segment) => segment.length > 0)
  if (samples.length === 0) return null
  return { kind: 'point_trend', pointCode: point.code, label: field.label, unit: field.unit, digits: field.digits, samples }
}

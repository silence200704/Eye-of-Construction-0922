import { metricDef } from '@/types/catalog'
import { buildReadingTrend } from '@/core/chart/dashboard'
import { inRange, rangeForQuestion } from '@/core/chart/range'
import { draft, type AnswerDraft } from '../answers/shared'
import { buildComparisonLink } from '../actions'
import type { AssistantSnapshot } from '../selectors'
import type { AskContext, AskEvidence, AskFact } from '../types'

export function answerCompare(snapshot: AssistantSnapshot, question: string, context: AskContext): AnswerDraft {
  const active = snapshot.points.filter(p => !p.archived)
  const named = active.filter(p => question.toUpperCase().includes(p.code.toUpperCase()))
  let ids = named.length ? named.map(p => p.id) : context.pointIds ?? []
  if (context.chosen && context.pointId && !ids.includes(context.pointId)) ids = [...ids, context.pointId]
  const range = rangeForQuestion(question, snapshot.now, context.range)
  if (ids.length !== 2) return draft('请选定两个测点；已确定的对象和时间范围会保留。', {
    status: 'need_choice', context: { ...context, pointIds: ids.slice(0, 1), range },
    candidates: active.filter(p => !ids.includes(p.id) && (!/裂缝/.test(question) || p.metric === 'crack_width')).map(p => ({ id: p.id, label: `${p.code} ${p.name}`, detail: p.buildingName })),
  })
  const points = ids.map(id => active.find(p => p.id === id))
  if (points.some(p => !p)) return draft('比较对象已失效，请重新选择两个在册测点。', { status: 'not_found' })
  const cards = []
  const facts: AskFact[] = []
  const evidence: AskEvidence[] = []
  const metrics = [...new Set(points.map(p => p!.metric))]
  for (const metric of metrics) for (const field of metricDef(metric).fields) {
    const group = points.filter(p => p!.metric === metric).map(p => p!.id)
    const model = buildReadingTrend(snapshot, group, metric, field.key, range)
    cards.push({ label: `${metricDef(metric).name} · ${field.label} (${field.unit})`, model })
    const values = group.map(id => factsOf({ snapshot, id, key: field.key, range, label: field.label, unit: field.unit, facts, evidence }))
    if (values.length === 2 && values.every(v => v !== null)) {
      facts.push({ label: `${field.label}最新值差（第一点－第二点）`, value: (values[0]!.latest - values[1]!.latest).toFixed(field.digits), unit: field.unit },
        { label: `${field.label}峰值差（第一点－第二点）`, value: (values[0]!.peak - values[1]!.peak).toFixed(field.digits), unit: field.unit },
        { label: `${field.label}峰值更高的测点`, value: values[0]!.peak === values[1]!.peak ? '峰值相同' : snapshot.points.find(p => p.id === group[values[0]!.peak > values[1]!.peak ? 0 : 1])!.code, unit: '' })
    }
  }
  const empty = cards.every(c => c.model.lines.length === 0)
  return draft(`${points.map(p => p!.code).join(' 与 ')}，${range.label}：${empty ? '没有有效读数。' : metrics.length === 1 ? '已按同一字段和单位比较最新值及区间峰值。' : '指标不同，按字段和单位分别展示。'}`, {
    status: empty ? 'not_found' : 'answered', facts, evidence, previews: [{ kind: 'point_compare', pointIds: ids, range, cards }],
    context: { pointIds: ids, range }, links: [buildComparisonLink(ids, range)],
    gaps: empty ? ['此范围没有有效记录，可以改看最近7天。'] : [],
    followups: ['改看最近7天', '哪一个区间峰值更高？', '打开这两个点的趋势'],
    dataNotes: ['仅使用本次范围内有效读数；毫米来自监测记录。缺值不补零。'],
  })
}

function factsOf(input: { snapshot: AssistantSnapshot; id: string; key: keyof import('@/types/domain').MetricValues;
  range: import('@/core/chart/range').TimeRange; label: string; unit: string; facts: AskFact[]; evidence: AskEvidence[] }) {
  const rows = input.snapshot.records.filter(r => r.pointId === input.id && r.quality === 'valid' && inRange(r.sampleTime, input.range) && Number.isFinite(r.values[input.key]))
    .sort((a,b) => a.sampleTime.localeCompare(b.sampleTime) || a.recordNo.localeCompare(b.recordNo))
  const latest = rows[rows.length - 1]
  if (!latest) return null
  const peak = rows.reduce((best,r) => r.values[input.key]! > best.values[input.key]! ? r : best)
  const code = input.snapshot.points.find(p => p.id === input.id)!.code
  for (const [label,row] of [['最新值',latest],['区间峰值',peak]] as const) {
    input.facts.push({ label: `${code} ${input.label}${label}`, value: String(row.values[input.key]), unit: input.unit })
    input.evidence.push({ kind: 'record', ref: row.recordNo, id: row.id, detail: `${code} ${label} · ${row.sampleTime} · ${row.values[input.key]}${input.unit}` })
  }
  return { latest: latest.values[input.key]!, peak: peak.values[input.key]! }
}

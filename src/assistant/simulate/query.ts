import { assessRecord, stateLabel } from '@/core/rules'
import { validateThresholds } from '@/core/assess/thresholds'
import { inRange, type TimeRange } from '@/core/chart/range'
import type { RuleThresholds } from '@/types/rules'
import type { AssistantSnapshot } from '../selectors'
import type { AskSimulationResult } from '../types'

export function simulateThresholds(input: { snapshot: AssistantSnapshot; pointId: string; range: TimeRange; thresholds: RuleThresholds }): AskSimulationResult {
  const error = validateThresholds(input.thresholds)
  if (error) throw new Error(error)
  const point = input.snapshot.details?.points.find(p => p.id === input.pointId)
  if (!point) throw new Error('试算测点不存在')
  const records = input.snapshot.records.filter(r => r.pointId === point.id && Date.parse(r.sampleTime) < input.range.toExclusive)
    .sort((a,b) => a.sampleTime.localeCompare(b.sampleTime) || a.recordNo.localeCompare(b.recordNo))
  const history: typeof records = []
  const rows: AskSimulationResult['rows'] = []
  for (const record of records) {
    const rule = input.snapshot.ruleAt(point.id,record.sampleTime)
    history.push(record)
    if (!inRange(record.sampleTime,input.range)) continue
    if (!rule || !rule.thresholds || rule.metric === 'environment') {
      rows.push({ recordNo: record.recordNo, original: '无法试算', candidate: '无法试算', reason: '采样时无数值规则', changed: false }); continue
    }
    const args = { point, values: record.values, baselineValues: record.baselineValues, quality: record.quality,
      device: input.snapshot.details?.devices.find(d => record.deviceId ? d.id === record.deviceId : d.pointId === point.id),
      history: [...history], at: record.sampleTime }
    const original = assessRecord({ ...args, rule })
    const candidate = assessRecord({ ...args, rule: { ...rule, thresholds: { ...input.thresholds } } })
    rows.push({ recordNo: record.recordNo, original: stateLabel(original.state), candidate: stateLabel(candidate.state),
      reason: candidate.reason, changed: original.state !== candidate.state })
  }
  return { kind: 'rule_simulate', range: input.range, rows }
}

/**
 * 规则与基准的按时间选取。
 *
 * 规则与基准都是版本化的：同一对象可以有多个版本，各自带生效时间。
 * 判定时必须按"采样时间"选取当时生效的版本，未来才生效的版本不参与当前判断 ——
 * 否则今天创建一个下周生效的新基准，再补录今天的数据，就会错误地套用未来基准。
 */
import type { Baseline, MetricKey } from '@/types/domain'
import type { AssessmentSnapshot, MonitoringRule, RuleMetric } from '@/types/rules'

/**
 * 规则匹配只关心"这个点位是谁、属于哪栋楼、测什么指标"。
 *
 * 收窄成这三个字段后，完整 `Point` 与看板/问答用的只读投影 `PointRef`
 * 都能直接传进来 —— 图表与判定共用同一套规则口径，不必为了类型复制一份。
 */
export interface PointFacts {
  id: string
  metric: MetricKey
  buildingId: string
}

export function ruleMetricOf(metric: MetricKey): RuleMetric | null {
  if (metric === 'crack_width') return 'crack_width'
  if (metric === 'tilt_xy') return 'tilt_xy'
  if (metric === 'vibration') return 'vibration'
  if (metric === 'temp_humidity') return 'environment'
  return null
}

/**
 * 规则是否适用于该测点：启用、指标一致，且落在规则的楼栋/测点范围内。
 * 规则表里四类指标同表存放，只看时间不看范围会取到别条规则的阈值 ——
 * 判定与图表必须共用这一个口径。
 */
export function ruleAppliesTo(rule: MonitoringRule, point: PointFacts): boolean {
  const metric = ruleMetricOf(point.metric)
  if (metric === null || !rule.enabled || rule.metric !== metric) return false
  if (rule.buildingIds.length > 0 && !rule.buildingIds.includes(point.buildingId)) return false
  if (rule.pointIds.length > 0 && !rule.pointIds.includes(point.id)) return false
  return true
}

/** 该测点适用的全部规则版本，按生效时间升序；供图表按时间切片。 */
export function rulesForPoint(rules: MonitoringRule[], point: PointFacts): MonitoringRule[] {
  return rules
    .filter((rule) => ruleAppliesTo(rule, point))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

export function ruleForPoint(rules: MonitoringRule[], point: PointFacts, at: string): MonitoringRule | undefined {
  const time = new Date(at).getTime()
  const applicable = rules.filter(
    (rule) => ruleAppliesTo(rule, point) && new Date(rule.effectiveFrom).getTime() <= time,
  )
  if (applicable.length === 0) return undefined
  return applicable.reduce((best, rule) =>
    new Date(rule.effectiveFrom).getTime() >= new Date(best.effectiveFrom).getTime() ? rule : best,
  )
}

export function baselineAtTime(baselines: Baseline[], pointId: string, at: string): Baseline | undefined {
  const time = new Date(at).getTime()
  const applicable = baselines.filter(
    (row) => row.pointId === pointId && new Date(row.effectiveFrom).getTime() <= time,
  )
  if (applicable.length === 0) return undefined
  return applicable.reduce((best, row) =>
    new Date(row.effectiveFrom).getTime() >= new Date(best.effectiveFrom).getTime() ? row : best,
  )
}

export function ruleIdOf(code: string): string {
  return `rule_${code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
}

/**
 * 旧规则迁移：v2 只存了规则行，没有跨版本稳定的 ruleId。
 * 缺少它会让事件归并标识为空，规则版本与事件去重都无法成立。
 * 按规则编号生成固定标识，并把版本行主键改成「规则标识@版本」。
 */
export function migrateLegacyRules(rules: MonitoringRule[]): { rows: MonitoringRule[]; changed: number } {
  const rows: MonitoringRule[] = []
  let changed = 0
  for (const row of rules) {
    const ruleId = row.ruleId === undefined || row.ruleId === null || row.ruleId === '' ? ruleIdOf(row.code) : row.ruleId
    const id = `${ruleId}@${row.version}`
    if (ruleId !== row.ruleId || id !== row.id) {
      rows.push({ ...row, ruleId, id })
      changed += 1
    }
  }
  return { rows, changed }
}

/** 判定快照：随证据写入事件，保证"为什么当时是橙色"可以事后追溯。 */
export function snapshotOf(rule: MonitoringRule): AssessmentSnapshot {
  return {
    ruleId: rule.ruleId,
    ruleCode: rule.code,
    ruleVersion: rule.version,
    thresholds: rule.thresholds === null ? null : { ...rule.thresholds },
    unit: rule.unit,
    source: rule.source,
  }
}

export type { AssessmentSnapshot } from '@/types/rules'
export { assessRecord, levelOfRecord, previewRecord, stateAllowedAction, stateLabel, stateTone } from './assess/engine'
export { triggerOf, type TriggerResult } from './assess/trigger'

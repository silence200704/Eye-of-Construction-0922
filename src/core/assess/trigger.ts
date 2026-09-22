/**
 * 判定值计算：把一次读数折算成可比较的数值。
 *
 * 相对基准的指标取变化量绝对值；倾角双轴分别比较取较大方向；
 * 振动按固定统计窗口有效值绝对判定。
 * 浮点减法误差在这里定点收敛：0.6 − 0.5 在浮点下是 0.09999999999999998，
 * 不处理会让"恰好等于阈值"判不进该等级。
 */
import type { MetricValues } from '@/types/domain'
import type { DataState, MonitoringRule, RuleThresholds } from '@/types/rules'

function roundTrigger(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export interface TriggerResult {
  /** 判定值：相对基准的变化量绝对值，或绝对判定指标的读数 */
  value: number | null
  /** 用于计算变化速率的带符号主值 */
  signed: number | null
  baseline: number | null
  basis: string
}

export function triggerOf(
  rule: MonitoringRule,
  values: MetricValues,
  baselineValues: MetricValues | null,
): TriggerResult {
  const none: TriggerResult = { value: null, signed: null, baseline: null, basis: '' }

  if (rule.metric === 'crack_width') {
    const base = rule.baselineSource === 'point' ? baselineValues?.width : rule.fixedBaseline?.width
    const value = values.width
    if (base === undefined || value === undefined) return none
    const delta = roundTrigger(value - base)
    return { value: Math.abs(delta), signed: delta, baseline: base, basis: '相对基准变化量绝对值' }
  }

  if (rule.metric === 'tilt_xy') {
    const baseX = rule.baselineSource === 'point' ? baselineValues?.angleX : rule.fixedBaseline?.angleX
    const baseY = rule.baselineSource === 'point' ? baselineValues?.angleY : rule.fixedBaseline?.angleY
    const candidates: { abs: number; signed: number; baseline: number }[] = []
    if (baseX !== undefined && values.angleX !== undefined) {
      const deltaX = roundTrigger(values.angleX - baseX)
      candidates.push({ abs: Math.abs(deltaX), signed: deltaX, baseline: baseX })
    }
    if (baseY !== undefined && values.angleY !== undefined) {
      const deltaY = roundTrigger(values.angleY - baseY)
      candidates.push({ abs: Math.abs(deltaY), signed: deltaY, baseline: baseY })
    }
    if (candidates.length === 0) return none
    const strongest = candidates.reduce((best, item) => (item.abs > best.abs ? item : best))
    return {
      value: strongest.abs,
      signed: strongest.signed,
      baseline: strongest.baseline,
      basis: 'X/Y 双轴分别比较，取绝对值较大方向',
    }
  }

  if (rule.metric === 'vibration') {
    const value = values.accelRms
    if (value === undefined) return none
    return { value, signed: value, baseline: null, basis: '固定统计窗口动态加速度有效值（绝对判定）' }
  }

  return none
}

/** 判定值落在哪一等级：等于阈值即命中，不向下取整。 */
export function levelOf(trigger: number, thresholds: RuleThresholds): DataState {
  if (trigger >= thresholds.red) return 'red'
  if (trigger >= thresholds.orange) return 'orange'
  if (trigger >= thresholds.yellow) return 'yellow'
  return 'normal'
}

/** 状态严重度排序，用于"只有升级才覆盖事件等级"的判断。 */
export const SEVERITY: Record<DataState, number> = {
  excluded: -1,
  unknown: 0,
  normal: 1,
  recovering: 2,
  yellow: 3,
  orange: 4,
  red: 5,
}

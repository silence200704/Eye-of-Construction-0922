/**
 * 判定引擎。
 *
 * 判定顺序按方案要求：先判数据质量，再判数值等级，再判变化速率与持续异常，
 * 最后判恢复趋势。数据不足时给出"无法判断"的原因，不能因为数据不足就显示"正常"。
 * 判定过程保留触发值、基准值与规则版本，保证预警可解释、可追溯。
 *
 * 数据状态与允许操作是两个维度：状态说明数据是什么情况，允许操作说明现在能做什么，
 * 两者在页面上分列展示，不能混为一谈。
 */
import { hasNumericReadings } from '@/types/catalog'
import type { Device, MetricKey, MetricValues, MonitorRecord, Point, QualityFlag } from '@/types/domain'
import type { DataState, MonitoringRule, RuleAssessment } from '@/types/rules'
import { outOfDeviceRange } from '@/core/validate'
import { SEVERITY, levelOf, triggerOf, type TriggerResult } from './trigger'

export interface AssessInput {
  rule: MonitoringRule
  point: Point
  values: MetricValues
  /** 该测点在采样时间生效的基准数值快照；绝对判定指标可为 null */
  baselineValues: MetricValues | null
  quality: QualityFlag
  device: Device | undefined
  /** 同测点同口径的历史记录，按采样时间升序，最后一条为当前记录 */
  history: MonitorRecord[]
  /** 当前记录的采样时间 */
  at: string
}

const STATE_LABEL: Record<DataState, string> = {
  unknown: '数据不足',
  normal: '未越限',
  yellow: '黄色关注',
  orange: '橙色排查',
  red: '红色紧急核查',
  recovering: '恢复待确认',
  excluded: '不参与判定',
}

const STATE_TONE: Record<DataState, 'gray' | 'green' | 'yellow' | 'orange' | 'red' | 'brand'> = {
  unknown: 'gray',
  normal: 'green',
  yellow: 'yellow',
  orange: 'orange',
  red: 'red',
  recovering: 'brand',
  excluded: 'gray',
}

/**
 * 数据状态对应的允许操作。
 * 与状态本身分开：状态回答"数据是什么情况"，允许操作回答"现在能做什么、由谁做"。
 */
const STATE_ACTION: Record<DataState, string> = {
  normal: '继续监测，无需处置',
  yellow: '已生成预警事件，等待责任人确认',
  orange: '已升级预警事件，安排定向排查',
  red: '已生成红色事件，立即通知并现场核查',
  recovering: '恢复待确认，须授权人员填写关闭依据后才能关闭',
  unknown: '补充数据后再判断，不得显示为正常',
  excluded: '先做数据核查，不参与判定',
}

export function stateLabel(state: DataState): string {
  return STATE_LABEL[state]
}

export function stateTone(state: DataState): 'gray' | 'green' | 'yellow' | 'orange' | 'red' | 'brand' {
  return STATE_TONE[state]
}

export function stateAllowedAction(state: DataState): string {
  return STATE_ACTION[state]
}

/**
 * 试算与录入预览用的临时记录：不写库，只参与本次判定。
 * 判定"持续异常"和"恢复待确认"时需要把当前这条一并纳入序列。
 */
export function previewRecord(input: {
  pointId: string
  metric: MetricKey
  values: MetricValues
  baselineValues: MetricValues | null
  unit: string
  sampleTime: string
  sampleWindow: string
}): MonitorRecord {
  return {
    id: `preview_${input.pointId}`,
    recordNo: '预览',
    pointId: input.pointId,
    deviceId: null,
    metric: input.metric,
    values: input.values,
    unit: input.unit,
    sampleTime: input.sampleTime,
    sampleWindow: input.sampleWindow,
    enteredAt: input.sampleTime,
    enteredBy: '预览',
    enteredByRole: '预览',
    source: 'manual',
    quality: 'valid',
    qualityNote: '',
    note: '',
    isBackfill: false,
    baselineVersion: null,
    baselineValues: input.baselineValues,
    revision: 0,
    revisions: [],
    createdAt: input.sampleTime,
  }
}

function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60_000
}

/** 变化速率需要至少两条同口径记录和正时间差。 */
function rateOf(rule: MonitoringRule, history: MonitorRecord[], current: TriggerResult, at: string): number | null {
  const previous = [...history].reverse().find((row) => triggerOf(rule, row.values, row.baselineValues).signed !== null)
  if (previous === undefined || current.signed === null) return null
  const hours = minutesBetween(previous.sampleTime, at) / 60
  if (hours <= 0) return null
  const before = triggerOf(rule, previous.values, previous.baselineValues).signed
  if (before === null) return null
  return Math.round(((current.signed - before) / hours) * 1e6) / 1e6
}

/** 持续异常：至少 N 条、跨度不少于若干分钟、相邻间隔不超过若干分钟且均越限。 */
function persistenceOf(rule: MonitoringRule, history: MonitorRecord[]): 'hit' | 'miss' | 'insufficient' {
  const thresholds = rule.thresholds
  if (thresholds === null) return 'insufficient'
  const run: MonitorRecord[] = []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const value = triggerOf(rule, history[index].values, history[index].baselineValues).value
    if (value === null || value < thresholds.yellow) break
    run.unshift(history[index])
  }
  if (run.length < rule.persistence.minRecords) return 'insufficient'
  const first = run[0]
  const last = run[run.length - 1]
  if (minutesBetween(first.sampleTime, last.sampleTime) < rule.persistence.minSpanMinutes) return 'insufficient'
  for (let index = 1; index < run.length; index += 1) {
    if (minutesBetween(run[index - 1].sampleTime, run[index].sampleTime) > rule.persistence.maxGapMinutes) return 'miss'
  }
  return 'hit'
}

/** 恢复待确认：连续 N 条有效记录低于「黄色阈值 × 比例」；只改变数据状态，不自动关闭问题。 */
function recoveryOf(rule: MonitoringRule, history: MonitorRecord[]): 'recovering' | 'miss' | 'insufficient' {
  const thresholds = rule.thresholds
  if (thresholds === null) return 'insufficient'
  const limit = thresholds.yellow * rule.recovery.yellowRatio
  const need = rule.recovery.minRecords
  const tail = history.slice(-need)
  if (tail.length < need) return 'insufficient'
  const allBelow = tail.every((row) => {
    const value = triggerOf(rule, row.values, row.baselineValues).value
    return value !== null && value < limit
  })
  if (!allBelow) return 'miss'
  if (rule.recovery.minSpanMinutes > 0) {
    if (minutesBetween(tail[0].sampleTime, tail[tail.length - 1].sampleTime) < rule.recovery.minSpanMinutes) {
      return 'insufficient'
    }
  }
  return 'recovering'
}

/** 温湿度只做环境提醒与复核，不生成结构红色预警。 */
function assessEnvironment(input: AssessInput): RuleAssessment {
  const condition = input.rule.environment
  const base = { ruleCode: input.rule.code, ruleVersion: input.rule.version, basis: '环境辅助数据' }
  if (condition === null) {
    return { ...base, state: 'unknown', triggerValue: null, baselineValue: null, reason: '', insufficientReason: '规则未配置环境条件' }
  }
  const temperature = input.values.temperature
  const humidity = input.values.humidity
  if (temperature === undefined && humidity === undefined) {
    return { ...base, state: 'unknown', triggerValue: null, baselineValue: null, reason: '', insufficientReason: '缺少温度或湿度读数' }
  }
  const outOfRange = (value: number | undefined, min: number | undefined, max: number | undefined): boolean =>
    value !== undefined && ((min !== undefined && value < min) || (max !== undefined && value > max))
  const hit =
    outOfRange(temperature, condition.tempMin, condition.tempMax) ||
    outOfRange(humidity, undefined, condition.humidityMax)
  if (!hit) {
    return {
      ...base,
      state: 'normal',
      triggerValue: temperature ?? null,
      baselineValue: null,
      reason: '温度与相对湿度均在环境提醒范围之外',
      insufficientReason: '',
    }
  }
  const consecutive = input.history.slice(-condition.persistenceRecords)
  const allHit =
    consecutive.length === condition.persistenceRecords &&
    consecutive.every((row) => {
      const t = row.values.temperature
      const h = row.values.humidity
      return outOfRange(t, condition.tempMin, condition.tempMax) || outOfRange(h, undefined, condition.humidityMax)
    })
  return {
    ...base,
    state: allHit ? 'orange' : 'yellow',
    triggerValue: temperature ?? humidity ?? null,
    baselineValue: null,
    reason: allHit
      ? `连续 ${condition.persistenceRecords} 条环境读数越限，生成环境复核任务；不单独作为结构危险结论`
      : `温度 ${temperature ?? '—'}℃ / 湿度 ${humidity ?? '—'}%RH 超出环境提醒范围，不单独作为结构危险结论`,
    insufficientReason: '',
    basis: '环境提醒',
  }
}

/**
 * 结构类指标的分级：先算判定值，再依次叠加变化速率与持续异常，最后判恢复趋势。
 * 任一步数据不足都不改判为"正常"，而是记录缺什么。
 */
function assessStructure(input: AssessInput, base: RuleAssessment): RuleAssessment {
  const { rule, values, baselineValues, history, at } = input
  const thresholds = rule.thresholds
  if (thresholds === null) {
    return { ...base, state: 'unknown', insufficientReason: '规则未配置阈值' }
  }

  const trigger = triggerOf(rule, values, baselineValues)
  if (trigger.value === null) {
    return {
      ...base,
      state: 'unknown',
      insufficientReason:
        rule.baselineSource === 'none' ? '缺少判定读数' : '该测点尚未设置有效基准，无法计算变化量',
    }
  }

  let state = levelOf(trigger.value, thresholds)
  let basis = trigger.basis
  let insufficient = ''
  let reason = state === 'normal' ? '' : `判定值 ${trigger.value.toFixed(2)} ${rule.unit} 达到${STATE_LABEL[state]}门槛`

  if (rule.rateThreshold !== null && state !== 'red') {
    const rate = rateOf(rule, history, trigger, at)
    if (rate === null) {
      insufficient = '历史记录不足两条或时间差为零，可判断绝对值，不能判断变化速率'
    } else if (rate >= rule.rateThreshold && SEVERITY[rule.rateLevel] > SEVERITY[state]) {
      state = rule.rateLevel
      basis = `变化速率 ${rate.toFixed(2)} ${rule.unit}/h ≥ ${rule.rateThreshold}`
      reason = `变化速率达到${STATE_LABEL[state]}门槛`
    }
  }

  const persistence = persistenceOf(rule, history)
  if (persistence === 'insufficient') {
    insufficient = insufficient === '' ? '数据不足，无法判断持续趋势' : insufficient
  } else if (persistence === 'hit' && SEVERITY[rule.persistence.level] > SEVERITY[state]) {
    state = rule.persistence.level
    basis = `持续异常：${rule.persistence.minRecords} 条有效记录均越限且覆盖不少于 ${rule.persistence.minSpanMinutes} 分钟`
    reason = '满足持续异常条件'
  }

  if (state === 'normal') {
    const recovery = recoveryOf(rule, history)
    if (recovery === 'recovering') {
      state = 'recovering'
      basis = `连续 ${rule.recovery.minRecords} 条低于黄色阈值的 ${Math.round(rule.recovery.yellowRatio * 100)}%`
      reason = '恢复待确认：只改变数据状态，不自动关闭问题'
    } else if (recovery === 'insufficient') {
      insufficient = insufficient === '' ? '记录条数不足，无法判断恢复趋势' : insufficient
    }
  }

  return {
    ...base,
    state,
    triggerValue: trigger.value,
    baselineValue: trigger.baseline,
    reason,
    insufficientReason: insufficient,
    basis,
  }
}

/** 判定一条记录：先做数据质量分流，再交给结构或环境判定。 */
export function assessRecord(input: AssessInput): RuleAssessment {
  const { rule, point, values, quality, device, at } = input
  const base: RuleAssessment = {
    ruleCode: rule.code,
    ruleVersion: rule.version,
    triggerValue: null,
    baselineValue: null,
    reason: '',
    insufficientReason: '',
    basis: '',
    state: 'excluded',
  }

  if (!hasNumericReadings(point.metric)) {
    return { ...base, reason: '人工检查点不产生数值记录，不参与判定' }
  }
  if (quality === 'invalid') {
    return { ...base, reason: '质量标记为无效：保存留痕，不参与判定' }
  }
  if (outOfDeviceRange(values, device)) {
    return { ...base, reason: '超出设备量程：标记为无效并进入数据核查，不触发结构预警' }
  }
  if (!rule.enabled) {
    return { ...base, reason: '规则未启用' }
  }
  if (new Date(rule.effectiveFrom).getTime() > new Date(at).getTime()) {
    return { ...base, reason: '规则尚未生效，不参与当前数据判断' }
  }
  if (rule.metric === 'environment') return assessEnvironment(input)
  return assessStructure(input, base)
}

/**
 * 单条记录的数值分级：只看绝对值或相对基准变化量，不含速率、持续与恢复判定。
 * 用于列表快速标注；完整判定以 assessRecord 为准。
 */
export function levelOfRecord(rule: MonitoringRule, record: MonitorRecord): DataState | null {
  if (rule.metric === 'environment') {
    const condition = rule.environment
    if (condition === null) return null
    const temperature = record.values.temperature
    const humidity = record.values.humidity
    const hit =
      (temperature !== undefined && (temperature < condition.tempMin || temperature > condition.tempMax)) ||
      (humidity !== undefined && humidity > condition.humidityMax)
    return hit ? 'yellow' : 'normal'
  }
  const thresholds = rule.thresholds
  if (thresholds === null) return null
  const trigger = triggerOf(rule, record.values, record.baselineValues)
  if (trigger.value === null) return null
  return levelOf(trigger.value, thresholds)
}

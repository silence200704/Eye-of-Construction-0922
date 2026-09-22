/**
 * 预警规则模型。
 *
 * 内置规则命名为「筑瞳 Demo 演示预警规则 V1.0」，用于验证录入、分级、通知与闭环流程，
 * **不是国家建筑安全限值**。正式项目须由结构专业人员结合建筑类型、结构状态、历史数据
 * 和设计要求核定，不能所有建筑统一使用一套限值。
 */
import type { AuditFields, MetricValues } from './domain'

/**
 * 数据状态。方案要求这些状态不能混在一起：未知、未越限、越限、恢复待确认分开呈现，
 * 数据不足时必须显示"无法判断"而不是"正常"。
 */
export type DataState = 'unknown' | 'normal' | 'yellow' | 'orange' | 'red' | 'recovering' | 'excluded'

export type RuleMetric = 'crack_width' | 'tilt_xy' | 'vibration' | 'environment'

export interface RuleThresholds {
  yellow: number
  orange: number
  red: number
}

/** 持续异常条件：至少 N 条有效记录、跨度不少于若干分钟、相邻间隔不超过若干分钟且均越限。 */
export interface PersistenceCondition {
  minRecords: number
  minSpanMinutes: number
  maxGapMinutes: number
  /** 满足持续条件后升级到的等级 */
  level: 'orange' | 'red'
}

/** 恢复条件：连续 N 条有效记录低于「黄色阈值 × 比例」时标为恢复待确认，不自动关闭。 */
export interface RecoveryCondition {
  yellowRatio: number
  minRecords: number
  /** 恢复判定是否也要求时间覆盖；0 表示只按记录条数判断 */
  minSpanMinutes: number
}

/** 温湿度环境条件：只生成环境提醒与复核，不单独生成结构危险结论。 */
export interface EnvironmentCondition {
  tempMin: number
  tempMax: number
  humidityMax: number
  persistenceRecords: number
}

export interface MonitoringRule extends AuditFields {
  /** 版本行主键：同一规则的不同版本各占一行 */
  id: string
  /**
   * 规则稳定标识：同一规则的所有版本共用。
   * 事件按 ruleId 归并，因此调整阈值不会把历史事件拆成两条。
   */
  ruleId: string
  /** 规则编号，例如 RULE-CRACK-001 */
  code: string
  name: string
  /** 适用建筑；空数组表示不限 */
  buildingIds: string[]
  /** 适用测点；空数组表示按指标匹配全部测点 */
  pointIds: string[]
  metric: RuleMetric
  unit: string
  /** 基准来源：point=随测点当前有效基准；fixed=固定基准；none=绝对判定不设基准 */
  baselineSource: 'point' | 'fixed' | 'none'
  fixedBaseline: MetricValues | null
  /** 环境类规则没有数值阈值，此处为 null */
  thresholds: RuleThresholds | null
  /** 变化速率阈值（每小时）；null 表示本规则不判速率 */
  rateThreshold: number | null
  rateLevel: 'orange' | 'red'
  persistence: PersistenceCondition
  recovery: RecoveryCondition
  environment: EnvironmentCondition | null
  /**
   * 规则版本。保存规则即生成新版本行，旧版本行原样保留；
   * 判定按采样时间选取当时生效的版本，因此调整阈值不影响历史事件。
   */
  version: string
  enabled: boolean
  /** 规则来源 */
  source: string
  /** 确认人 */
  confirmedBy: string
  /** 生效时间：未来生效的规则不参与当前数据判断 */
  effectiveFrom: string
  note: string
}

/** 判定结果：可解释预警需要能看到触发值、基准值、命中的规则与版本。 */
export interface RuleAssessment {
  state: DataState
  /** 触发值：变化量或绝对值 */
  triggerValue: number | null
  baselineValue: number | null
  ruleCode: string
  ruleVersion: string
  reason: string
  /** 数据不足时说明缺什么，供页面显示"无法判断"而不是"正常" */
  insufficientReason: string
  /** 命中的判定方式：绝对值 / 变化量 / 变化速率 / 持续异常 / 环境 */
  basis: string
}

/** 判定快照：随证据写入事件，保证"为什么当时是橙色"可以事后追溯。 */
export interface AssessmentSnapshot {
  ruleId: string
  ruleCode: string
  ruleVersion: string
  thresholds: RuleThresholds | null
  unit: string
  source: string
}

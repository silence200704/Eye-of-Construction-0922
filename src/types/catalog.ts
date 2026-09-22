/**
 * 业务字典：演示身份、点位类型、指标定义与录入字段。
 * 规则阈值属于 V0.2，本文件在 V0.1 只描述"录入什么、单位是什么、变化量怎么算"。
 */
import type { MetricKey, MetricValueKey, MetricValues, PointType, QualityFlag, RecordSource } from './domain'

export const APP_VERSION = 'V0.3'
/** 版本阶段：开发中的版本在界面上如实标注，避免把未完成的版本当成交付版 */
export const APP_STAGE = '开发中'
/** 数据结构版本：v4 起纳入 V0.3 的巡检计划、任务、问题、照片附件与维修工单 */
export const SCHEMA_VERSION = 4
export const BACKUP_FORMAT = 'zhutong-demo-backup'

/**
 * 采样时间比录入时间早出这么多分钟即视为历史补录。
 * 方案 §13.3 要求补录数据标记为历史发现，不得伪装成实时预警；阈值属演示约定。
 */
export const BACKFILL_THRESHOLD_MINUTES = 30

export interface RoleDef {
  key: string
  name: string
  duty: string
}

/** 演示身份：V0.1 用于区分录入人与操作留痕，V2.0 由服务端账号与权限控制。 */
export const ROLES: RoleDef[] = [
  { key: 'safety', name: '学校安全管理人员', duty: '全校总览、计划制定、审核督办与授权关闭' },
  { key: 'property', name: '物业值班人员', duty: '接单、到场、现场排查与临时措施记录' },
  { key: 'device', name: '设备管理员', duty: '建档、校准、设备点检与规则维护' },
  { key: 'inspector', name: '巡检人员', duty: '到点检查、拍照取证与异常上报' },
  { key: 'repair', name: '维修人员', duty: '接单处理、填写措施材料与完工照片' },
  { key: 'reviewer', name: '验收人员', duty: '复核处理措施与前后证据并提交验收结论' },
]

/**
 * 可以在演示里切换的身份。
 *
 * 比 ROLES 少一个「验收人员」：验收通过与退回已在核心状态机收口到学校安全管理人员，
 * 该身份在演示中没有任何可执行动作，留在切换列表里只会让人选到一个空角色。
 * 角色定义仍留在 ROLES —— 历史数据里的 executorRole、时间线里的角色名都还要能显示；
 * 将来把复核流程独立出来时，这份列表改回 ROLES 即可。
 */
export const DEMO_ROLES: RoleDef[] = ROLES.filter((row) => row.key !== 'reviewer')

export interface PointTypeDef {
  key: PointType
  name: string
  metric: MetricKey
  desc: string
}

export const POINT_TYPES: PointTypeDef[] = [
  { key: 'crack', name: '裂缝开合测点', metric: 'crack_width', desc: '记录裂缝宽度与相对初始基准的变化量 Δw' },
  { key: 'tilt', name: '倾角测点', metric: 'tilt_xy', desc: '记录安装面双轴相对姿态与基准变化量' },
  { key: 'vibration', name: '振动测点', metric: 'vibration', desc: '记录固定统计窗口内的加速度有效值与峰值' },
  { key: 'temp_humidity', name: '温湿度辅助测点', metric: 'temp_humidity', desc: '环境辅助数据，不单独作为结构结论依据' },
  { key: 'manual_check', name: '人工检查点', metric: 'inspection', desc: '仅建档与定位，供人工巡检与必查点使用，不产生数值记录' },
]

/** 不产生数值记录的指标：人工检查点只做档案与定位。 */
export const INSPECTION_METRIC: MetricKey = 'inspection'

export interface MetricField {
  key: MetricValueKey
  label: string
  unit: string
  step: number
  digits: number
  placeholder: string
}

export interface DeltaItem {
  label: string
  value: number | null
  unit: string
  digits: number
}

export interface MetricDef {
  key: MetricKey
  name: string
  unit: string
  unitOptions: string[]
  fields: MetricField[]
  baselineFields: MetricField[]
  baselineNote: string
  /** 相对基准的变化量；无相对基准的指标返回空数组。 */
  deltas: (values: MetricValues, baseline: MetricValues | null) => DeltaItem[]
}

const CRACK_DELTAS = (v: MetricValues, b: MetricValues | null): DeltaItem[] => {
  if (b?.width === undefined || v.width === undefined) return []
  return [{ label: 'Δw 相对基准', value: round(v.width - b.width, 2), unit: 'mm', digits: 2 }]
}

const TILT_DELTAS = (v: MetricValues, b: MetricValues | null): DeltaItem[] => {
  if (b === null) return []
  const out: DeltaItem[] = []
  if (b.angleX !== undefined && v.angleX !== undefined) {
    out.push({ label: 'ΔX 相对基准', value: round(v.angleX - b.angleX, 2), unit: '°', digits: 2 })
  }
  if (b.angleY !== undefined && v.angleY !== undefined) {
    out.push({ label: 'ΔY 相对基准', value: round(v.angleY - b.angleY, 2), unit: '°', digits: 2 })
  }
  if (out.length === 2 && out[0].value !== null && out[1].value !== null) {
    out.push({
      label: '最大轴变化',
      value: round(Math.max(Math.abs(out[0].value), Math.abs(out[1].value)), 2),
      unit: '°',
      digits: 2,
    })
  }
  return out
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export const METRICS: MetricDef[] = [
  {
    key: 'crack_width',
    name: '裂缝开合',
    unit: 'mm',
    unitOptions: ['mm'],
    fields: [{ key: 'width', label: '裂缝宽度', unit: 'mm', step: 0.01, digits: 2, placeholder: '例如 0.62' }],
    baselineFields: [
      { key: 'width', label: '初始宽度基准', unit: 'mm', step: 0.01, digits: 2, placeholder: '例如 0.50' },
    ],
    baselineNote: '以安装时经确认的初始宽度为基准，历史基准按版本保留。',
    deltas: CRACK_DELTAS,
  },
  {
    key: 'tilt_xy',
    name: '倾角变化',
    unit: '°',
    unitOptions: ['°'],
    fields: [
      { key: 'angleX', label: 'X 轴角度', unit: '°', step: 0.01, digits: 2, placeholder: '例如 0.35' },
      { key: 'angleY', label: 'Y 轴角度', unit: '°', step: 0.01, digits: 2, placeholder: '例如 -0.12' },
    ],
    baselineFields: [
      { key: 'angleX', label: 'X 轴基准', unit: '°', step: 0.01, digits: 2, placeholder: '例如 0.20' },
      { key: 'angleY', label: 'Y 轴基准', unit: '°', step: 0.01, digits: 2, placeholder: '例如 -0.10' },
    ],
    baselineNote: '双轴分别与基准比较，不换算为整栋楼倾斜率。',
    deltas: TILT_DELTAS,
  },
  {
    key: 'vibration',
    name: '楼板振动',
    unit: 'm/s²',
    unitOptions: ['m/s²', 'g'],
    fields: [
      { key: 'accelRms', label: '加速度有效值', unit: 'm/s²', step: 0.001, digits: 3, placeholder: '例如 0.052' },
      { key: 'accelPeak', label: '加速度峰值', unit: 'm/s²', step: 0.001, digits: 3, placeholder: '例如 0.180' },
    ],
    baselineFields: [],
    baselineNote: '振动按固定统计窗口的有效值绝对判定，不设相对基准；单位必须在录入时明确。',
    deltas: () => [],
  },
  {
    key: 'temp_humidity',
    name: '温湿度辅助',
    unit: '℃ / %RH',
    unitOptions: ['℃ / %RH'],
    fields: [
      { key: 'temperature', label: '温度', unit: '℃', step: 0.1, digits: 1, placeholder: '例如 24.6' },
      { key: 'humidity', label: '相对湿度', unit: '%RH', step: 0.1, digits: 1, placeholder: '例如 58.2' },
    ],
    baselineFields: [],
    baselineNote: '环境辅助数据不设结构基准，不能单凭环境值生成结构危险结论。',
    deltas: () => [],
  },
  {
    key: 'inspection',
    name: '人工检查',
    unit: '',
    unitOptions: [],
    fields: [],
    baselineFields: [],
    baselineNote: '人工检查点不产生数值记录；检查清单、照片上报与必查点覆盖在后续版本提供。',
    deltas: () => [],
  },
]

/** 该指标是否产生数值记录；人工检查点返回 false。 */
export function hasNumericReadings(key: MetricKey): boolean {
  return metricDef(key).fields.length > 0
}

/** CSV 值列：所有指标字段的并集，导入时只填该测点需要的列。 */
export interface CsvValueColumn {
  key: MetricValueKey
  label: string
  unit: string
}

export const CSV_VALUE_COLUMNS: CsvValueColumn[] = METRICS.flatMap((metric) =>
  metric.fields.map((field) => ({ key: field.key, label: field.label, unit: field.unit })),
)

export const CSV_HEADER: string[] = [
  '测点编号',
  '采样时间',
  ...CSV_VALUE_COLUMNS.map((column) => column.label),
  '单位',
  '统计窗口',
  '质量标记',
  '备注',
]

/** 质量标记的文本口径：中文写在 CSV 里，落库转成枚举值。 */
export const CSV_QUALITY_TEXT: Record<string, string> = {
  有效: 'valid',
  存疑: 'suspect',
  无效: 'invalid',
}

export interface Option<T extends string> {
  value: T
  label: string
}

export const QUALITY_OPTIONS: Option<QualityFlag>[] = [
  { value: 'valid', label: '有效' },
  { value: 'suspect', label: '存疑（需复核）' },
  { value: 'invalid', label: '无效（不参与判定）' },
]

/** 录入表单的可选来源：csv 只能由导入产生，不手工选择。 */
export const SOURCE_OPTIONS: Option<RecordSource>[] = [
  { value: 'manual', label: '人工录入' },
  { value: 'device', label: '设备上报（演示补录）' },
]

/** 展示用来源标签（含导入产生的 csv）。 */
export const SOURCE_LABELS: Option<RecordSource>[] = [
  ...SOURCE_OPTIONS,
  { value: 'csv', label: 'CSV 批量导入' },
]

export const STRUCTURE_TYPES: string[] = ['框架结构', '砖混结构', '砌体结构', '钢结构', '框架剪力墙结构', '待补充']

export const DEVICE_HEALTH_OPTIONS: Option<'unknown' | 'online' | 'offline'>[] = [
  { value: 'unknown', label: '未接入' },
  { value: 'online', label: '正常在线' },
  { value: 'offline', label: '离线 / 待排查' },
]

export function metricDef(key: MetricKey): MetricDef {
  const found = METRICS.find((m) => m.key === key)
  if (found === undefined) throw new Error(`未知指标：${key}`)
  return found
}

export function pointTypeDef(key: PointType): PointTypeDef {
  const found = POINT_TYPES.find((p) => p.key === key)
  if (found === undefined) throw new Error(`未知点位类型：${key}`)
  return found
}

export function roleName(key: string): string {
  return ROLES.find((r) => r.key === key)?.name ?? key
}

export function qualityLabel(value: QualityFlag): string {
  return QUALITY_OPTIONS.find((q) => q.value === value)?.label ?? value
}

export function sourceLabel(value: RecordSource): string {
  return SOURCE_LABELS.find((s) => s.value === value)?.label ?? value
}

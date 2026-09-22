/**
 * 录入与建档校验。
 * 原则：缺项不默认为零；重复时间不静默覆盖；无效数据必须写明原因。
 */
import { BACKFILL_THRESHOLD_MINUTES, hasNumericReadings, metricDef } from '@/types/catalog'
import type { Device, MetricKey, MetricValues, MonitorRecord, QualityFlag } from '@/types/domain'
import type { FieldDef, ValidationIssue } from '@/types/forms'
import { parseNum } from './format'
import { dayKey, isBackfill, isFutureBeyond, isValidDateTime } from './time'

export interface ReadingInput {
  pointId: string
  metric: MetricKey
  values: MetricValues
  unit: string
  sampleTime: string
  sampleWindow: string
  quality: QualityFlag
  qualityNote: string
  note: string
  excludeRecordId: string | null
  /** 所选采集设备；用于超量程判定，未选设备时为 undefined */
  device: Device | undefined
  /** 录入时刻；用于历史补录判定 */
  enteredAt: string
}

export interface ReadingCheck {
  issues: ValidationIssue[]
  /** 超出所选设备量程：不阻止提交，按方案标记无效并进入数据核查 */
  outOfRange: boolean
  /** 历史补录：采样时间明显早于录入时间，不得伪装成实时预警 */
  backfill: boolean
}

/** 逐字段校验录入值；缺项不默认为零，重复时间不静默覆盖。 */
function checkValues(input: ReadingInput, issues: ValidationIssue[]): void {
  if (!hasNumericReadings(input.metric)) {
    issues.push({ field: 'pointId', message: '人工检查点不产生数值记录，无需录入监测数据' })
    return
  }
  for (const field of metricDef(input.metric).fields) {
    const value = input.values[field.key]
    if (value === undefined || value === null || !Number.isFinite(value)) {
      issues.push({ field: field.key, message: `${field.label}为必填，缺项不按零处理` })
      continue
    }
    const range = RANGE[field.key]
    if (range !== undefined && (value < range.min || value > range.max)) {
      issues.push({
        field: field.key,
        message: `${range.label}超出可接受区间 ${range.min}~${range.max}${field.unit}，请核对单位与量程`,
      })
    }
  }
}

function checkTiming(input: ReadingInput, existing: MonitorRecord[], issues: ValidationIssue[]): boolean {
  if (!isValidDateTime(input.sampleTime)) {
    issues.push({ field: 'sampleTime', message: '采样时间格式无效，请重新选择' })
    return false
  }
  if (isFutureBeyond(input.sampleTime)) {
    issues.push({ field: 'sampleTime', message: '采样时间晚于当前时间，请核对现场时钟' })
    return false
  }
  const duplicate = existing.find(
    (record) =>
      record.id !== input.excludeRecordId &&
      record.pointId === input.pointId &&
      record.metric === input.metric &&
      dayKey(record.sampleTime) === dayKey(input.sampleTime) &&
      sameMinute(record.sampleTime, input.sampleTime),
  )
  if (duplicate !== undefined) {
    issues.push({
      field: 'sampleTime',
      message: `同一点位该分钟已有记录 ${duplicate.recordNo}，请改用修订并保存原值，或调整采样时间`,
    })
    return false
  }
  return true
}

/** 值是否落在所选设备的量程之外；设备未登记量程时无从判断，返回 false。 */
export function outOfDeviceRange(values: MetricValues, device: Device | undefined): boolean {
  if (device === undefined || device.rangeMin === null || device.rangeMax === null) return false
  return Object.values(values).some(
    (value) => value !== undefined && (value < device.rangeMin! || value > device.rangeMax!),
  )
}

/** 各指标取值的合理区间，超出即判定为录入错误（非安全阈值）。 */
const RANGE: Record<string, { min: number; max: number; label: string }> = {
  width: { min: 0, max: 2000, label: '裂缝宽度' },
  angleX: { min: -180, max: 180, label: 'X 轴角度' },
  angleY: { min: -180, max: 180, label: 'Y 轴角度' },
  accelRms: { min: 0, max: 200, label: '加速度有效值' },
  accelPeak: { min: 0, max: 500, label: '加速度峰值' },
  temperature: { min: -50, max: 120, label: '温度' },
  humidity: { min: 0, max: 100, label: '相对湿度' },
}

export function checkReading(input: ReadingInput, existing: MonitorRecord[]): ReadingCheck {
  const issues: ValidationIssue[] = []
  checkValues(input, issues)

  if (input.unit.trim() === '') {
    issues.push({ field: 'unit', message: '单位必填' })
  }

  const timeOk = checkTiming(input, existing, issues)

  if (input.metric === 'vibration' && input.sampleWindow.trim() === '') {
    issues.push({ field: 'sampleWindow', message: '振动必须填写统计窗口，未提供原始采样不生成真实波形' })
  }

  const outOfRange = outOfDeviceRange(input.values, input.device)
  // 超量程不阻止提交：按方案标记为无效并进入数据核查，因此要求填写质量说明
  const needsQualityNote = input.quality === 'invalid' || outOfRange
  if (needsQualityNote && input.qualityNote.trim() === '') {
    issues.push({
      field: 'qualityNote',
      message: outOfRange
        ? `读数超出设备量程 ${input.device?.rangeText ?? ''}，将标记为无效并进入数据核查，请填写说明`
        : '标记为无效时必须说明原因，否则无法追溯',
    })
  }

  const backfill = timeOk && isBackfill(input.sampleTime, input.enteredAt, BACKFILL_THRESHOLD_MINUTES)
  if (backfill && input.note.trim() === '') {
    issues.push({
      field: 'note',
      message: '采样时间明显早于录入时间，属历史补录，必须填写补录说明；补录数据不得伪装成实时预警',
    })
  }

  return { issues, outOfRange, backfill }
}

function sameMinute(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return Math.abs(da.getTime() - db.getTime()) < 60_000
}

/** 由表单 schema 推导必填与数值校验，供统一表单组件复用。 */
export function validateFields(model: Record<string, unknown>, fields: FieldDef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const field of fields) {
    if (field.visible !== undefined && !field.visible(model)) continue
    if (field.type === 'readonly') continue
    const raw = model[field.key]
    if (field.type === 'number') {
      const value = typeof raw === 'number' ? raw : parseNum(String(raw ?? ''))
      if (value === null) {
        if (field.required === true) issues.push({ field: field.key, message: `${field.label}为必填` })
        continue
      }
      if (field.min !== undefined && value < field.min) {
        issues.push({ field: field.key, message: `${field.label}不得小于 ${field.min}${field.unit ?? ''}` })
      }
      if (field.max !== undefined && value > field.max) {
        issues.push({ field: field.key, message: `${field.label}不得大于 ${field.max}${field.unit ?? ''}` })
      }
      continue
    }
    const text = String(raw ?? '').trim()
    if (field.required === true && text === '') {
      issues.push({ field: field.key, message: `${field.label}为必填` })
    }
  }
  return issues
}

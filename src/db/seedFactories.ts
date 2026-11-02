/**
 * 示例数据的工厂函数与常量：统一补齐审计字段与归档字段，避免每条数据重复书写。
 * 示例数据与实测档案在界面上分开标识。
 */
import type {
  Archivable,
  AuditFields,
  Baseline,
  Building,
  DataSource,
  Device,
  Floor,
  MetricKey,
  MetricValues,
  MonitorRecord,
  Point,
  PointType,
} from '@/types/domain'
import { BACKFILL_THRESHOLD_MINUTES, pointTypeDef } from '@/types/catalog'
import { fromLocalInput, isBackfill } from '@/core/time'

export const AT = fromLocalInput('2026-09-15T09:30')
export const SEED_ACTOR = '演示数据初始化'
export const SEED_ROLE = '设备管理员'

export function base(): AuditFields & Archivable {
  return {
    createdAt: AT,
    createdBy: SEED_ACTOR,
    updatedAt: AT,
    updatedBy: SEED_ACTOR,
    status: 'active',
    archiveReason: '',
    archivedAt: null,
    archivedBy: '',
  }
}

export function plusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

interface BuildingInput {
  id: string
  code: string
  name: string
  purpose: string
  buildYear: number
  floorCount: number
  area: number
  structureType: string
  owner: string
  backupPerson: string
  dataSource: DataSource
  source: string
  x: number
  y: number
  w: number
  h: number
  rotate: number
}

export function building(input: BuildingInput): Building {
  const { x, y, w, h, rotate, ...rest } = input
  return {
    ...base(),
    managerUnit: '演示大学后勤保障处',
    userUnit: '演示大学',
    ownerPhone: '0000-0000000',
    remark: '',
    footprint: { x, y, w, h, rotate },
    ...rest,
  }
}

export function floor(input: {
  id: string
  buildingId: string
  floorNo: number
  name: string
  zones: string[]
  remark?: string
}): Floor {
  return { ...base(), planVersion: 1, remark: '', ...input }
}

export function point(input: {
  id: string
  code: string
  name: string
  buildingId: string
  floorId: string
  zoneId: string
  type: PointType
  coord: { x: number; y: number }
  owner: string
  backupPerson: string
  installDate: string
  dataSource: DataSource
  remark: string
}): Point {
  return {
    ...base(),
    planVersion: 1,
    locationHistory: [],
    ...input,
    metric: pointTypeDef(input.type).metric,
    // 建档即绑定标签：编号与测点编号一致，现场核对时一眼能看出是不是这个点
    nfc: {
      code: `NFC-${input.code}`,
      version: 1,
      boundAt: '2026-09-15T01:30:00.000Z',
      boundBy: '演示数据初始化',
      remark: '演示用标签编号，纯前端阶段读取为模拟',
    },
  }
}

export function device(input: {
  id: string
  code: string
  name: string
  pointId: string
  model: string
  serial: string
  rangeMin: number | null
  rangeMax: number | null
  unit: string
  nodeId: string
  mountPosition: string
  direction: string
  installDate: string
  calibratedAt: string
}): Device {
  const { rangeMin, rangeMax, unit, ...rest } = input
  return {
    ...base(),
    gateway: 'DAYU200 楼栋网关-03（演示）',
    health: 'unknown',
    remark: '',
    rangeMin,
    rangeMax,
    unit,
    rangeText: rangeMin === null || rangeMax === null ? '' : `${rangeMin}~${rangeMax} ${unit}`.trim(),
    ...rest,
  }
}

export function baseline(input: {
  id: string
  pointId: string
  metric: MetricKey
  values: MetricValues
  unit: string
  reason: string
}): Baseline {
  return {
    ...input,
    version: 1,
    /**
     * 生效时间显著早于全部演示数据：一键演示脚本会回溯十余天写入记录，
     * 基准生效日必须早于该窗口，否则脚本前几条会因"无生效基准"判不出变化量。
     */
    effectiveFrom: fromLocalInput('2026-08-01T00:00'),
    createdBy: SEED_ACTOR,
    createdAt: AT,
    current: true,
  }
}

interface RecordInput {
  id: string
  recordNo: string
  pointId: string
  deviceId: string
  metric: MetricKey
  values: MetricValues
  unit: string
  sampleTime: string
  sampleWindow?: string
  baselineValues: MetricValues | null
  /** 录入相对采样时间的延迟分钟数；超过补录阈值即标记为历史补录 */
  enteredDelayMinutes?: number
  note?: string
}

export function record(input: RecordInput): MonitorRecord {
  const sampleTime = fromLocalInput(input.sampleTime)
  const enteredAt = plusMinutes(sampleTime, input.enteredDelayMinutes ?? 10)
  return {
    id: input.id,
    recordNo: input.recordNo,
    pointId: input.pointId,
    deviceId: input.deviceId,
    metric: input.metric,
    values: input.values,
    unit: input.unit,
    sampleTime,
    sampleWindow: input.sampleWindow ?? '',
    enteredAt,
    enteredBy: '演示传感器模拟器',
    enteredByRole: 'system',
    source: 'device',
    quality: 'valid',
    qualityNote: '',
    note: input.note ?? '',
    isBackfill: isBackfill(sampleTime, enteredAt, BACKFILL_THRESHOLD_MINUTES),
    baselineVersion: input.baselineValues === null ? null : 1,
    baselineValues: input.baselineValues,
    revision: 0,
    revisions: [],
    createdAt: sampleTime,
  }
}

export const B01 = 'bld_b01'
export const B02 = 'bld_b02'
export const B03 = 'bld_b03'
export const B04 = 'bld_b04'
export const B05 = 'bld_b05'

export const F0401 = 'flr_b04_01'
export const F0301 = 'flr_b03_01'
export const F0302 = 'flr_b03_02'
export const F0303 = 'flr_b03_03'
export const F0101 = 'flr_b01_01'
export const F0201 = 'flr_b02_01'
export const F0501 = 'flr_b05_01'
export const F0502 = 'flr_b05_02'
export const F0503 = 'flr_b05_03'
export const F0504 = 'flr_b05_04'
export const F0505 = 'flr_b05_05'
/** B01 / B02 的第二层：楼栋档案声明 2 层，原先只有 1 层记录，按声明补的**演示示意**层 */
export const F0102 = 'flr_b01_02'
export const F0202 = 'flr_b02_02'

export const P_CRACK = 'pnt_b03_f2_crack01'
export const P_TILT = 'pnt_b03_f2_tilt01'
export const P_VIB = 'pnt_b03_f2_vib01'
export const P_TH = 'pnt_b03_f2_th01'
export const P_B03_CHECK = 'pnt_b03_f1_check01'
export const P_B01_CHECK = 'pnt_b01_f1_check01'
export const P_B02_CHECK = 'pnt_b02_f1_check01'
export const P_B04_CHECK = 'pnt_b04_f1_check01'
export const P_B05_CHECK = 'pnt_b05_f1_check01'

export const D_CRACK = 'dev_b03_f2_crack01'
export const D_TILT = 'dev_b03_f2_tilt01'
export const D_VIB = 'dev_b03_f2_vib01'
export const D_TH = 'dev_b03_f2_th01'

export const CRACK_BASE: MetricValues = { width: 0.5 }
export const TILT_BASE: MetricValues = { angleX: 0, angleY: 0 }

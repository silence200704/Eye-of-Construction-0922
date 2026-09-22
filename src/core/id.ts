/** 内部主键与业务编号生成，保证刷新后不重复、可读可追溯。 */
import type { Building, Device, MonitorRecord, Point, PointType } from '@/types/domain'
import { nowIso } from './time'

let seq = 0

export function uid(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function maxSuffix(codes: string[], prefix: string): number {
  let max = 0
  for (const code of codes) {
    if (!code.startsWith(prefix)) continue
    const parsed = Number.parseInt(code.slice(prefix.length), 10)
    if (Number.isFinite(parsed) && parsed > max) max = parsed
  }
  return max
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** 楼栋编号 B01、B02…… */
export function nextBuildingCode(buildings: Building[]): string {
  return `B${pad(maxSuffix(buildings.map((b) => b.code), 'B') + 1, 2)}`
}

const POINT_TYPE_CODE: Record<PointType, string> = {
  crack: 'CRACK',
  tilt: 'TILT',
  vibration: 'VIB',
  temp_humidity: 'TH',
  manual_check: 'CHECK',
}

/** 楼层编号形如 B03-F2，楼层名称形如 二层 */
export function floorCode(buildingCode: string, floorNo: number): string {
  return `${buildingCode}-F${floorNo}`
}

const FLOOR_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function floorName(floorNo: number): string {
  if (floorNo === 0) return '首层'
  if (floorNo < 0) return `地下${FLOOR_CN[Math.abs(floorNo)] ?? Math.abs(floorNo)}层`
  if (floorNo <= 10) return `${FLOOR_CN[floorNo]}层`
  return `${floorNo}层`
}

/** 测点编号形如 B03-F2-CRACK01 */
export function nextPointCode(opts: {
  buildingCode: string
  floorNo: number
  type: PointType
  existing: Point[]
}): string {
  const prefix = `${floorCode(opts.buildingCode, opts.floorNo)}-${POINT_TYPE_CODE[opts.type]}`
  return `${prefix}${pad(maxSuffix(opts.existing.map((p) => p.code), prefix) + 1, 2)}`
}

/** 设备编号形如 B03-F2-CRACK01-DEV1 */
export function nextDeviceCode(pointCode: string, existing: Device[]): string {
  const prefix = `${pointCode}-DEV`
  return `${prefix}${maxSuffix(existing.map((d) => d.code), prefix) + 1}`
}

/** 记录编号形如 R20260919-001，按自然日重新计数 */
export function nextRecordNo(dayKey: string, existing: MonitorRecord[]): string {
  const prefix = `R${dayKey}-`
  return `${prefix}${pad(maxSuffix(existing.map((r) => r.recordNo), prefix) + 1, 3)}`
}

/**
 * 业务编号用的日期键（YYYYMMDD）：取 ISO 串的日期部分，不按浏览器时区换算。
 *
 * 与 `core/time.dayKey()` 的区别是刻意的：dayKey 按本地时区解释采样时刻，用于"当天"这类业务判断；
 * 编号前缀取记录自带的日期字段，同一份数据换个时区打开算出的编号不会变，也就不会出现
 * "同一份备份在两台机器上算出不同编号"。空值回退到当前时刻，避免生成 "ISS--001" 这种残号。
 */
export function isoDayKey(at: string): string {
  const key = at.slice(0, 10).replace(/-/g, '')
  return key === '' ? nowIso().slice(0, 10).replace(/-/g, '') : key
}

/**
 * 通用业务编号：前缀 + 日期 + 当日序号，如 ISS-20260920-001 / WO-20260920-001。
 * 序号取当日已有编号的最大值 +1，因此已作废的编号不会被复用。
 */
export function nextDatedNo(prefix: string, dayKey: string, existing: string[]): string {
  const head = `${prefix}-${dayKey}-`
  return `${head}${pad(maxSuffix(existing, head) + 1, 3)}`
}

/** 问题编号 ISS-YYYYMMDD-001 */
export function nextIssueNo(dayKey: string, existing: string[]): string {
  return nextDatedNo('ISS', dayKey, existing)
}

/** 工单编号 WO-YYYYMMDD-001 */
export function nextWorkOrderNo(dayKey: string, existing: string[]): string {
  return nextDatedNo('WO', dayKey, existing)
}

/** 巡检任务编号 TK-YYYYMMDD-001 */
export function nextTaskNo(dayKey: string, existing: string[]): string {
  return nextDatedNo('TK', dayKey, existing)
}

/** 计划编号 PLAN-YYYYMMDD-001 */
export function nextPlanCode(dayKey: string, existing: string[]): string {
  return nextDatedNo('PLAN', dayKey, existing)
}

/** 点位的 NFC 标签编号形如 NFC-B03-F02-CRACK01（与测点编号绑定，便于现场核对） */
export function nfcLabelOf(pointCode: string): string {
  return `NFC-${pointCode}`
}

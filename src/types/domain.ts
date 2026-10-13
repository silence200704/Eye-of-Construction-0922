/**
 * 筑瞳 Demo 领域模型（V0.1 建档与录入）
 * 编号与状态含义按 V1.7 方案保留，V2.0 迁移到服务端时不变。
 */

/** 归一化坐标：取值 0~1，原点为底图左上角。可与 Leaflet CRS.Simple 坐标互转。 */
export interface NormPoint {
  x: number
  y: number
}

/** 校园图上的楼栋占位（中心 + 尺寸 + 朝向，均为归一化值；朝向单位为度） */
export interface Footprint {
  x: number
  y: number
  w: number
  h: number
  rotate: number
}

export type ArchiveStatus = 'active' | 'archived'

/** real=实测建档；demo=示例数据。方案要求图上明确区分实测点与演示数据。 */
export type DataSource = 'real' | 'demo'

/**
 * manual_check 为人工巡检位置：只做档案与定位，不产生数值记录。
 * 方案要求传感器点位与人工巡检位置分别建档，地图同时展示已监测区域与仅人工检查区域。
 */
export type PointType = 'crack' | 'tilt' | 'vibration' | 'temp_humidity' | 'manual_check'

/**
 * 点位上的 NFC 标签编号与版本（V0.3 到点打卡用）。
 * 换标签时递增版本、保留旧编号，历史打卡记录保留当时读到的编号与版本，
 * 这样"当时到底在不在这个点"事后仍然可查。纯前端阶段读取是模拟的，界面必须写明。
 */
export interface NfcLabel {
  code: string
  version: number
  boundAt: string
  boundBy: string
  remark: string
}

export type MetricKey = 'crack_width' | 'tilt_xy' | 'vibration' | 'temp_humidity' | 'inspection'

export type QualityFlag = 'valid' | 'suspect' | 'invalid'

/**
 * 记录来源。
 * csv 表示批量导入的历史数据：与现场手工录入走同一条判定链路，但责任界面不同，
 * 审计时要能一眼分辨是"某人在现场录的"还是"某人导入的一批数据"。
 */
export type RecordSource = 'manual' | 'device' | 'csv'

/** 按指标存放的数值集合；缺项保持 undefined，不默认为零。 */
export interface MetricValues {
  width?: number
  angleX?: number
  angleY?: number
  accelRms?: number
  accelPeak?: number
  temperature?: number
  humidity?: number
}

export type MetricValueKey = keyof MetricValues

export interface AuditFields {
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface Archivable {
  status: ArchiveStatus
  archiveReason: string
  archivedAt: string | null
  archivedBy: string
}

export interface Building extends AuditFields, Archivable {
  id: string
  code: string
  name: string
  purpose: string
  buildYear: number | null
  floorCount: number | null
  area: number | null
  structureType: string
  managerUnit: string
  userUnit: string
  owner: string
  ownerPhone: string
  backupPerson: string
  source: string
  footprint: Footprint
  dataSource: DataSource
  remark: string
}

export interface Floor extends AuditFields, Archivable {
  id: string
  buildingId: string
  floorNo: number
  name: string
  zones: string[]
  planVersion: number
  remark: string
}

export interface Point extends AuditFields, Archivable {
  id: string
  code: string
  name: string
  buildingId: string
  floorId: string
  zoneId: string
  type: PointType
  /** 点位上的 NFC 标签；未绑定为 null（V0.3 打卡时按"未登记标签"处理） */
  nfc: NfcLabel | null
  metric: MetricKey
  coord: NormPoint
  planVersion: number
  /** 位置变更历史：完整保留移动前的位置，不覆盖 */
  locationHistory: LocationChange[]
  owner: string
  backupPerson: string
  installDate: string
  dataSource: DataSource
  remark: string
}

export type DeviceHealth = 'unknown' | 'online' | 'offline'

/** 位置变更留痕：设备或测点移动以新增记录方式保留，不覆盖历史位置。 */
export interface LocationSnapshot {
  buildingId: string
  floorId: string
  zoneId: string
  coord: NormPoint
}

export interface LocationChange {
  at: string
  by: string
  role: string
  reason: string
  from: LocationSnapshot
  to: LocationSnapshot
}

export interface Device extends AuditFields, Archivable {
  id: string
  code: string
  name: string
  pointId: string
  model: string
  serial: string
  /** 量程数值化用于超量程判定；rangeText 仅用于展示 */
  rangeMin: number | null
  rangeMax: number | null
  rangeText: string
  unit: string
  nodeId: string
  gateway: string
  mountPosition: string
  direction: string
  installDate: string
  calibratedAt: string
  health: DeviceHealth
  remark: string
}

/** 基准值按版本保存，修改需记录版本与原因，历史版本不覆盖。 */
export interface Baseline {
  id: string
  pointId: string
  metric: MetricKey
  values: MetricValues
  unit: string
  version: number
  reason: string
  effectiveFrom: string
  createdBy: string
  createdAt: string
  current: boolean
}

export interface RecordRevision {
  at: string
  by: string
  role: string
  reason: string
  before: {
    values: MetricValues
    unit: string
    sampleTime: string
    quality: QualityFlag
    sampleWindow: string
    /** 修订前的基准快照；采样时间改动跨过基准生效点时，快照会随之变化 */
    baselineVersion: number | null
    baselineValues: MetricValues | null
  }
}

export interface MonitorRecord {
  id: string
  recordNo: string
  pointId: string
  deviceId: string | null
  metric: MetricKey
  values: MetricValues
  unit: string
  sampleTime: string
  sampleWindow: string
  enteredAt: string
  enteredBy: string
  enteredByRole: string
  source: RecordSource
  quality: QualityFlag
  qualityNote: string
  note: string
  /**
   * 历史补录标记：采样时间明显早于录入时间即为补录。
   * 方案要求补录数据标记为历史发现，不得伪装成实时预警。
   */
  isBackfill: boolean
  /** 录入当时的基准快照与版本，保证历史记录的变化量可解释、可复算 */
  baselineVersion: number | null
  baselineValues: MetricValues | null
  revision: number
  revisions: RecordRevision[]
  createdAt: string
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'revise'
  | 'import'
  | 'export'
  | 'seed'
  | 'clear'
  | 'exportReport'

export type AuditObject =
  | 'building'
  | 'floor'
  | 'point'
  | 'device'
  | 'baseline'
  | 'record'
  | 'system'

export interface AuditLog {
  id: string
  at: string
  actor: string
  actorRole: string
  action: AuditAction
  objectType: AuditObject
  objectId: string
  objectLabel: string
  summary: string
  reason: string
}

/** 操作人身份；V0.1 通过演示身份切换区分，V2.0 由服务端账号与权限控制。 */
export interface Actor {
  name: string
  role: string
}

import type { MonitoringRule } from './rules'
import type { AlarmEvent, AlarmNotification } from './events'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from './inspection'

/**
 * 备份里的照片：Blob 不能直接进 JSON，导出时转成 base64 data URL，导入时还原。
 * 只备份压缩后的图与缩略图（原始大图本来就不保留）。
 */
export type BackupAttachment = Omit<IssueAttachment, 'blob' | 'thumb'> & { blob: string; thumb: string }

/** 备份包结构；含业务数据、日志、预警规则与照片附件（v4 起附件已纳入）。 */
export interface BackupPackage {
  format: string
  appVersion: string
  schemaVersion: number
  exportedAt: string
  exportedBy: string
  counts: Record<string, number>
  data: {
    buildings: Building[]
    floors: Floor[]
    points: Point[]
    devices: Device[]
    baselines: Baseline[]
    records: MonitorRecord[]
    audits: AuditLog[]
    // v2 起纳入；旧备份可能没有该字段
    rules?: MonitoringRule[]
    // v3 起纳入
    events?: AlarmEvent[]
    notifications?: AlarmNotification[]
    // v4 起纳入（V0.3 巡检与维修处置）；旧备份没有这些字段，读取时按空数组处理
    plans?: InspectionPlan[]
    tasks?: InspectionTask[]
    issues?: InspectionIssue[]
    workOrders?: WorkOrder[]
    attachments?: BackupAttachment[]
    /** V1-D 起纳入；旧备份没有这两个字段，读取时按空数组处理 */
    maintenancePlans?: unknown[]
    maintenanceTasks?: unknown[]
  }
  /** 导出时被跳过的损坏附件条数（照片字节已丢失、无法编码）；旧备份没有该字段 */
  brokenPhotos?: number
}

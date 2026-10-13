/**
 * V2-1 契约冻结 · 七类资源的读写 DTO。
 *
 * 读 DTO 的字段**取自现有领域类型**（`@/types/domain|events|inspection`），不是另写一份：
 * 契约允许做的只是"挑字段 + 补服务端字段（rev）"，这样前端显示与服务端写入口天然同一口径。
 *
 * 三条刻意的取舍：
 * - 读 DTO **不带 Blob**：影像字节走对象存储直链，DTO 只给元数据与校验和；
 * - `rev` 是**服务端版本**（单调递增），本地演示由适配层近似（见 `adapter/local.ts` 的 `revOf`）；
 * - 时间字段保留原语义：`sampleTime`（采样）/`enteredAt`（录入）/`openedAt`（事件生成）…，
 *   契约不引入"统一时间戳"，否则补录数据会被伪装成实时。
 */
import type { AttachmentKind, IssueStatus, RecheckOutcome, WorkOrderOrigin, WorkOrderStatus, ReviewAction, TaskStatus } from '@/types/inspection'
import type { ArchiveStatus, DataSource, DeviceHealth, MetricKey, MetricValues, PointType, QualityFlag, RecordSource } from '@/types/domain'
import type { EventLevel, EventStatus } from '@/types/events'
import type { WriteAction } from './scope'

export const RESOURCE_NAMES = ['archive', 'record', 'event', 'issue', 'workOrder', 'task', 'media'] as const
export type ResourceName = (typeof RESOURCE_NAMES)[number]

export interface ResourceDef {
  name: ResourceName
  label: string
  /** 现有 IndexedDB 表名（映射表要用） */
  tables: string[]
  /** 未来服务端路径前缀（V2-2 起生效） */
  path: string
  writes: WriteAction[]
  note: string
}

export const RESOURCES: Record<ResourceName, ResourceDef> = {
  archive: {
    name: 'archive', label: '档案（楼栋/楼层/测点/设备/基准）', tables: ['buildings', 'floors', 'points', 'devices', 'baselines'],
    path: '/api/v1/archive', writes: ['archive_write'],
    note: '基准按版本保存，历史版本不覆盖；测点位置变更以新增历史的方式保留',
  },
  record: {
    name: 'record', label: '监测记录（手录 / CSV / 设备补录）', tables: ['records'],
    path: '/api/v1/records', writes: ['record_write', 'record_revise'],
    note: '手录与 CSV 共用同一条判定链路，来源字段区分责任界面',
  },
  event: {
    name: 'event', label: '预警事件与通知', tables: ['events', 'notifications'],
    path: '/api/v1/events', writes: ['event_acknowledge', 'event_close'],
    note: '判定快照随证据写入；事件按 ruleId 归并、按 ruleVersion 解释历史',
  },
  issue: {
    name: 'issue', label: '问题池（三类来源共用）', tables: ['issues'],
    path: '/api/v1/issues', writes: ['issue_report', 'issue_from_event', 'issue_review', 'issue_recheck_register', 'issue_recheck_outcome'],
    note: '审核六出口、复查三轮次；关闭只由复查结论或审核出口给出',
  },
  workOrder: {
    name: 'workOrder', label: '维修工单', tables: ['workOrders'],
    path: '/api/v1/work-orders', writes: ['work_order_dispatch', 'work_order_accept', 'work_order_submit', 'work_order_verify'],
    note: '状态机六态；验收通过只把问题推进到待复查，不自动关闭',
  },
  task: {
    name: 'task', label: '任务（巡检 / 保养）', tables: ['tasks', 'plans', 'maintenanceTasks', 'maintenancePlans'],
    path: '/api/v1/tasks', writes: ['inspection_checkin', 'inspection_complete', 'maintenance_generate', 'maintenance_execute'],
    note: '业务键主键：计划ID@执行时刻；任务范围取生成时快照',
  },
  media: {
    name: 'media', label: '影像资源（附件）', tables: ['attachments'],
    path: '/api/v1/media', writes: ['attachment_upload'],
    note: '照片必须有且只有一个归属；只留压缩图与缩略图，不留原始大图',
  },
}

/* ------------------------------ 读 DTO ------------------------------ */

export type ArchiveRecordKind = 'building' | 'floor' | 'point' | 'device' | 'baseline'

export interface ArchiveDto {
  id: string
  kind: ArchiveRecordKind
  code: string
  name: string
  buildingId: string | null
  pointId: string | null
  status: ArchiveStatus
  dataSource: DataSource
  /** 建档/来源说明（设备的安装位置等归入 remark） */
  source: string
  /** 基准版本；非基准资源为 null */
  version: number | null
  pointType: PointType | null
  metric: MetricKey | null
  health: DeviceHealth | null
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  rev: number
}

export interface RecordDto {
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
  source: RecordSource
  quality: QualityFlag
  qualityNote: string
  isBackfill: boolean
  baselineVersion: number | null
  baselineValues: MetricValues | null
  revision: number
  rev: number
}

export interface EventDto {
  id: string
  eventNo: string
  pointId: string
  ruleId: string
  ruleCode: string
  /** 当前等级对应的规则版本：历史解释按它，不按"现在的阈值" */
  ruleVersion: string
  level: EventLevel
  peakLevel: EventLevel
  status: EventStatus
  unit: string
  openedAt: string
  openedBy: string
  lastTriggerAt: string
  lastTriggerValue: number
  evidenceCount: number
  acknowledgedAt: string | null
  closedAt: string | null
  closedBy: string
  closeBasis: string
  rev: number
}

export interface IssueDto {
  id: string
  issueNo: string
  source: string
  submissionKey: string
  pointId: string | null
  buildingId: string
  floorId: string
  zoneId: string
  eventId: string | null
  taskId: string | null
  maintenanceTaskId: string | null
  anomalyType: string
  status: IssueStatus
  reviewAction: ReviewAction | null
  reviewCategory: string
  reviewedAt: string | null
  reviewedBy: string
  workOrderIds: string[]
  recheckRounds: number
  latestOutcome: RecheckOutcome | null
  createdAt: string
  updatedAt: string
  rev: number
}

export interface WorkOrderDto {
  id: string
  orderNo: string
  origin: WorkOrderOrigin
  issueId: string | null
  eventId: string | null
  pointId: string | null
  title: string
  status: WorkOrderStatus
  assignee: string
  assignedBy: string
  assignedAt: string | null
  dueAt: string | null
  measures: string
  materials: string
  submittedAt: string | null
  reviewedAt: string | null
  photoCount: number
  createdAt: string
  updatedAt: string
  rev: number
}

export interface TaskDto {
  id: string
  taskNo: string
  kind: 'inspection' | 'maintenance'
  planId: string
  planCode: string
  buildingId: string
  plannedAt: string
  dueAt: string
  status: TaskStatus | string
  owner: string
  executorRole: string
  /** 逐点完成情况（巡检）；保养任务为 0 */
  checkedCount: number
  totalCount: number
  createdAt: string
  updatedAt: string
  rev: number
}

export interface MediaDto {
  id: string
  ownerType: 'issue' | 'workOrder' | 'maintenanceTask'
  ownerId: string
  issueId: string | null
  workOrderId: string | null
  maintenanceTaskId: string | null
  kind: AttachmentKind
  draftId: string
  fileName: string
  mimeType: string
  size: number
  width: number
  height: number
  uploadedAt: string
  uploadedBy: string
  capturedAt: string | null
  /** V2-5 起由对象存储给出；本地演示为 null（不假装有校验和） */
  sha256: string | null
  rev: number
}

export type ResourceDto = ArchiveDto | RecordDto | EventDto | IssueDto | WorkOrderDto | TaskDto | MediaDto

/* ------------------------------ 写请求体 ------------------------------ */

export interface RecordWrite {
  pointId: string
  metric: MetricKey
  values: MetricValues
  unit: string
  sampleTime: string
  sampleWindow: string
  quality: QualityFlag
  qualityNote: string
  note: string
}

export interface RecordReviseWrite {
  recordId: string
  revision: number
  draft: RecordWrite
  reason: string
}

export interface IssueReportWrite {
  pointId: string | null
  buildingId: string
  floorId: string
  zoneId: string
  anomalyType: string
  description: string
  photoDraftIds: string[]
}

export interface IssueReviewWrite {
  issueId: string
  action: ReviewAction
  category: string
  note: string
  duplicateOf: string | null
  linkedEventId: string | null
  photoDraftIds: string[]
}

export interface WorkOrderWrite {
  orderId: string
  to: WorkOrderStatus
  assignee: string
  dueAt: string | null
  measures: string
  materials: string
  acceptancePhotoDraftIds: string[]
}

export interface EventCloseWrite {
  eventId: string
  basis: string
  basisDetail: string
}

export interface AttachmentWrite {
  draftId: string
  kind: AttachmentKind
  ownerType: MediaDto['ownerType']
  ownerId: string
  fileName: string
  mimeType: string
  size: number
  width: number
  height: number
  capturedAt: string | null
}

/** 请求体里**禁止出现**的字段：编号、状态与创建/更新痕迹由服务端维护。 */
export const SERVER_OWNED_FIELDS = [
  'id', 'rev', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
  'issueNo', 'orderNo', 'eventNo', 'recordNo', 'taskNo', 'submissionKey',
] as const

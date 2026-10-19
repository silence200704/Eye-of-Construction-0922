/**
 * 设备保养（V1-D）。
 *
 * 与巡检分开的原因：巡检回答"今天该去哪些点位看"，保养回答"这台设备多久维护一次"。
 * 两者复用同一套已验证的做法 —— **周期命中、检查清单、计划快照、业务键幂等建单**，
 * 但**不复用 `InspectionTask`**：保养一个周期只完成一次，还要登记"下次保养日期"，
 * 字段与流转都与巡检任务不同，硬塞进一个实体只会让两边都别扭。
 */
import type { AuditFields } from './domain'
import type { ChecklistAnswer, ChecklistItem, IssueTimelineEntry, PlanCycle } from './inspection'
import type { DraftPhotoInput } from '@/db/inspection/attachments'

/** 保养任务状态：一个周期只有"待执行 / 已完成"两种，没有部分完成。 */
export const MAINTENANCE_STATUSES = [
  { key: 'pending', name: '待保养' },
  { key: 'done', name: '已完成' },
] as const
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]['key']

/** 保养计划。周期与检查清单沿用巡检的结构，负责人从演示人员名单里选。 */
export interface MaintenancePlan extends AuditFields {
  id: string
  /** 编号 MP-YYYYMMDD-001 */
  code: string
  name: string
  deviceId: string
  /** 设备所在测点（便于台账与定位）；设备未绑定测点时为 null */
  pointId: string | null
  buildingId: string
  cycle: PlanCycle
  startDate: string
  endDate: string | null
  owner: string
  checklist: ChecklistItem[]
  enabled: boolean
  remark: string
  /** 服务端对象版本（本地演示库没有；写入时必须原样带回） */
  rev?: number
}

/**
 * 计划快照：任务生成当时的设备、周期、负责人与检查项。
 * 改计划不能追溯改写历史任务，否则"当时按什么要求做的"就查不出来了。
 */
export interface MaintenanceSnapshot {
  planCode: string
  planName: string
  deviceCode: string
  deviceName: string
  pointId: string | null
  /** 生成任务当时的位置：设备/测点日后调拨时，历史任务仍能说明当时在哪执行 */
  buildingId: string
  floorId: string
  zoneId: string
  owner: string
  cycle: PlanCycle
  checklist: ChecklistItem[]
}

/** 一次保养执行：检查结果、措施、材料、现场照片与下次保养日期。 */
export interface MaintenanceExecution {
  /** 实际执行时间（ISO） */
  at: string
  by: string
  byRole: string
  checklist: ChecklistAnswer[]
  measures: string
  materials: string
  photos: string[]
  /** 下次保养日期（YYYY-MM-DD），由周期算出、允许人工调整 */
  nextDueDate: string
  note: string
  /**
   * 异常项描述。有异常项时**必填**，且不论是否转问题都落在执行记录里 ——
   * 只留一个异常数量的话，事后没人知道到底哪里不对。
   */
  abnormalNote: string
  /** 由本次执行转出并在同一事务创建的问题；未转问题为 null（与问题的 maintenanceTaskId 互为反向） */
  issueId: string | null
}

export interface MaintenanceTask extends AuditFields {
  /** 业务键主键：`计划ID@执行时刻`，并发重复生成会被数据库主键挡住 */
  id: string
  /** 编号 MT-YYYYMMDD-001 */
  taskNo: string
  planId: string
  deviceId: string
  /** 计划执行时刻（ISO）与当日截止时刻 */
  plannedAt: string
  dueAt: string
  status: MaintenanceStatus
  snapshot: MaintenanceSnapshot
  /** 执行记录内嵌在任务上：一个周期只执行一次，不另建一对一记录表 */
  execution: MaintenanceExecution | null
  timeline: IssueTimelineEntry[]
  /** 服务端对象版本（本地演示库没有；写入时必须原样带回） */
  rev?: number
}

/**
 * 保养写入的返回结果。
 * 失败时**数据库没有变化**（事务整体回滚），界面按 `error` 提示即可；
 * `created` / `skipped` 只有任务生成入口会填。
 */
export interface MaintenanceResult {
  ok: boolean
  error: string
  /** 成功时的业务编号（计划编号 / 任务编号），便于界面回显 */
  label: string
  created: number
  skipped: number
}

/** 一次保养执行的提交内容（页面收集，判定与组装在 core 与 db 层）。 */
export interface MaintenanceExecuteInput {
  answers: ChecklistAnswer[]
  measures: string
  materials: string
  nextDueDate: string
  note: string
  photoDrafts: DraftPhotoInput[]
  /**
   * 异常留痕：`createIssue` 为真时在同一事务转成问题（来源记「保养发现」）。
   * 描述必填、无异常不得转问题这两条由 `planMaintenanceExecute` 判定，界面只是收集输入。
   */
  anomaly: { createIssue: boolean; note: string }
}

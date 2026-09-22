/**
 * 浏览器本地数据库（IndexedDB）。
 * V0.1 全部业务数据保存在本机；V2.0 以服务端接口替换本层，编号与状态含义不变。
 */
import Dexie, { type Table } from 'dexie'
import type { AuditLog, Baseline, Building, Device, Floor, MonitorRecord, Point } from '@/types/domain'
import type { MonitoringRule } from '@/types/rules'
import type { AlarmEvent, AlarmNotification } from '@/types/events'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'

export const DB_NAME = 'zhutong-demo'

export class ZhutongDatabase extends Dexie {
  buildings!: Table<Building, string>
  floors!: Table<Floor, string>
  points!: Table<Point, string>
  devices!: Table<Device, string>
  baselines!: Table<Baseline, string>
  records!: Table<MonitorRecord, string>
  audits!: Table<AuditLog, string>
  rules!: Table<MonitoringRule, string>
  events!: Table<AlarmEvent, string>
  notifications!: Table<AlarmNotification, string>
  plans!: Table<InspectionPlan, string>
  tasks!: Table<InspectionTask, string>
  issues!: Table<InspectionIssue, string>
  workOrders!: Table<WorkOrder, string>
  attachments!: Table<IssueAttachment, string>

  constructor() {
    super(DB_NAME)
    this.version(1).stores({
      buildings: 'id, code, status',
      floors: 'id, buildingId, status',
      points: 'id, code, buildingId, floorId, status',
      devices: 'id, code, pointId, status',
      baselines: 'id, pointId, current, version',
      records: 'id, pointId, sampleTime, recordNo',
      audits: 'id, at, objectType',
    })
    // v2：预警规则独立成表，规则按版本与生效时间参与判定
    this.version(2).stores({
      rules: 'id, code, metric, enabled',
    })
    // v3：规则在同一表内按版本存多行；新增预警事件与站内通知
    this.version(3).stores({
      rules: 'id, ruleId, code, metric, enabled',
      events: 'id, eventNo, pointId, ruleId, status, level, openedAt',
      notifications: 'id, eventId, level, createdAt',
    })
    // v4：V0.3 巡检与维修处置；只新增表，不改动任何旧表，已有数据原样保留
    this.version(4).stores({
      plans: 'id, code, buildingId, kind',
      tasks: 'id, taskNo, planId, buildingId, status, plannedAt',
      issues: 'id, issueNo, source, pointId, eventId, taskId, status, createdAt',
      workOrders: 'id, orderNo, origin, issueId, eventId, pointId, status',
      attachments: 'id, issueId, workOrderId, kind',
    })
  }
}

export const db = new ZhutongDatabase()

/** 清除浏览器数据会丢失本地内容，设置页需给出容量提示与备份入口。 */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage?.estimate === undefined) return null
  const estimate = await navigator.storage.estimate()
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
}

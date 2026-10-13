/** 数据访问与审计留痕：所有写操作经由本文件，保证状态变更同时更新记录与日志。 */
import { db } from './database'
import type { MonitoringRule } from '@/types/rules'
import type { AlarmEvent, AlarmNotification } from '@/types/events'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceTask } from '@/types/maintenance'
import type {
  AuditAction,
  AuditLog,
  AuditObject,
  Baseline,
  Building,
  Device,
  Floor,
  MonitorRecord,
  Point,
} from '@/types/domain'
import { uid } from '@/core/id'
import { toPlain } from '@/core/plain'
import { announceChange } from './tabSync'
import { nowIso } from '@/core/time'

export interface Dataset {
  buildings: Building[]
  floors: Floor[]
  points: Point[]
  devices: Device[]
  baselines: Baseline[]
  records: MonitorRecord[]
  audits: AuditLog[]
  rules: MonitoringRule[]
  events: AlarmEvent[]
  notifications: AlarmNotification[]
  /** V0.3 起纳入（旧备份没有这些字段，读取时按空数组处理） */
  plans: InspectionPlan[]
  tasks: InspectionTask[]
  issues: InspectionIssue[]
  workOrders: WorkOrder[]
  attachments: IssueAttachment[]
  /** V1-D 起纳入（旧备份没有这些字段，读取时按空数组处理） */
  maintenancePlans: MaintenancePlan[]
  maintenanceTasks: MaintenanceTask[]
}

export interface AuditInput {
  actor: string
  actorRole: string
  action: AuditAction
  objectType: AuditObject
  objectId: string
  objectLabel: string
  summary: string
  reason?: string
}

export async function readDataset(): Promise<Dataset> {
  const [buildings, floors, points, devices, baselines, records, audits, rules, events, notifications, plans, tasks, issues, workOrders, attachments, maintenancePlans, maintenanceTasks] =
    await Promise.all([
      db.buildings.toArray(),
      db.floors.toArray(),
      db.points.toArray(),
      db.devices.toArray(),
      db.baselines.toArray(),
      db.records.toArray(),
      db.audits.orderBy('at').reverse().toArray(),
      db.rules.toArray(),
      db.events.toArray(),
      db.notifications.toArray(),
      db.plans.toArray(),
      db.tasks.toArray(),
      db.issues.toArray(),
      db.workOrders.toArray(),
      db.attachments.toArray(),
      db.maintenancePlans.toArray(),
      db.maintenanceTasks.toArray(),
    ])
  return {
    buildings,
    floors,
    points,
    devices,
    baselines,
    records,
    audits,
    rules,
    events,
    notifications,
    plans,
    tasks,
    issues,
    workOrders,
    attachments,
    maintenancePlans,
    maintenanceTasks,
  }
}

export async function clearDataset(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
  announceChange()
}

export async function writeDataset(data: Dataset): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
    await db.buildings.bulkPut(toPlain(data.buildings))
    await db.floors.bulkPut(toPlain(data.floors))
    await db.points.bulkPut(toPlain(data.points))
    await db.devices.bulkPut(toPlain(data.devices))
    await db.baselines.bulkPut(toPlain(data.baselines))
    await db.records.bulkPut(toPlain(data.records))
    await db.audits.bulkPut(toPlain(data.audits))
    await db.rules.bulkPut(toPlain(data.rules))
    await db.events.bulkPut(toPlain(data.events))
    await db.notifications.bulkPut(toPlain(data.notifications))
    await db.plans.bulkPut(toPlain(data.plans))
    await db.tasks.bulkPut(toPlain(data.tasks))
    await db.issues.bulkPut(toPlain(data.issues))
    await db.workOrders.bulkPut(toPlain(data.workOrders))
    // 附件含 Blob：toPlain 对 Blob 原样返回（交给结构化克隆），这里不能换成 JSON 深拷贝
    await db.attachments.bulkPut(toPlain(data.attachments))
    await db.maintenancePlans.bulkPut(toPlain(data.maintenancePlans))
    await db.maintenanceTasks.bulkPut(toPlain(data.maintenanceTasks))
  })
  announceChange()
}

/** 构造一条操作日志（不写库）：需要与业务数据同事务提交时先构造、再一起 bulkPut。 */
export function buildAuditLog(input: AuditInput): AuditLog {
  return {
    id: uid('log'),
    at: nowIso(),
    actor: input.actor,
    actorRole: input.actorRole,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    objectLabel: input.objectLabel,
    summary: input.summary,
    reason: input.reason ?? '',
  }
}

export async function writeAudit(input: AuditInput): Promise<AuditLog> {
  const entry = buildAuditLog(input)
  await db.audits.put(toPlain(entry))
  announceChange()
  return entry
}

export async function putBuilding(row: Building): Promise<void> {
  await db.buildings.put(toPlain(row))
}

export async function putFloor(row: Floor): Promise<void> {
  await db.floors.put(toPlain(row))
}

export async function putPoint(row: Point): Promise<void> {
  await db.points.put(toPlain(row))
}

export async function putPoints(rows: Point[]): Promise<void> {
  await db.points.bulkPut(toPlain(rows))
}

export async function putDevice(row: Device): Promise<void> {
  await db.devices.put(toPlain(row))
}

export async function putRecord(row: MonitorRecord): Promise<void> {
  await db.records.put(toPlain(row))
}

export async function putRule(row: MonitoringRule): Promise<void> {
  await db.rules.put(toPlain(row))
}

export async function putRules(rows: MonitoringRule[]): Promise<void> {
  await db.rules.bulkPut(toPlain(rows))
}

/**
 * 规则迁移：删旧主键 + 写新主键在**同一个事务**里完成。
 *
 * 分开写会留下一个窗口：删完还没写时刷新或崩溃，规则就永久没了
 * （迁移的正是"旧库唯一的规则副本"）。同事务要么都成、要么都不动。
 */
export async function replaceRules(removeIds: string[], rows: MonitoringRule[]): Promise<void> {
  await db.transaction('rw', db.rules, async () => {
    if (removeIds.length > 0) await db.rules.bulkDelete(removeIds)
    if (rows.length > 0) await db.rules.bulkPut(toPlain(rows))
  })
}

export async function putEvent(row: AlarmEvent): Promise<void> {
  await db.events.put(toPlain(row))
}

export async function putNotification(row: AlarmNotification): Promise<void> {
  await db.notifications.put(toPlain(row))
}

/**
 * 批量写通知：一次事务写完。
 * 逐条 put 每条都要开一次事务，中途失败会留下一半已展示、一半未展示的通知，
 * 超时提醒的口径就变得不可解释了。
 */
export async function putNotifications(rows: AlarmNotification[]): Promise<void> {
  if (rows.length === 0) return
  await db.notifications.bulkPut(toPlain(rows))
}

/** 确认事件：事件状态与它名下所有通知的确认状态同事务提交，不留"通知已确认、事件还在待确认"。 */
export async function commitEventAcknowledge(input: {
  event: AlarmEvent
  notifications: AlarmNotification[]
}): Promise<void> {
  await db.transaction('rw', db.events, db.notifications, async () => {
    await db.events.put(toPlain(input.event))
    if (input.notifications.length > 0) await db.notifications.bulkPut(toPlain(input.notifications))
  })
}

/**
 * 授权关闭事件：事件本体、关联问题的时间线、审计日志同事务提交。
 *
 * 关闭是一条链的收尾（预警 → 问题 → 工单 → 验收 → 复测 → 关闭），
 * 分两次写会留下"事件已关闭、问题时间线上没有这条依据"的单向留痕 —— 而这套系统的价值
 * 恰恰在于从任意一端进去都能看到同一件事。
 */
export async function commitEventClose(input: {
  event: AlarmEvent
  issues: InspectionIssue[]
  logs: AuditLog[]
}): Promise<void> {
  await db.transaction('rw', db.events, db.issues, db.audits, async () => {
    await db.events.put(toPlain(input.event))
    if (input.issues.length > 0) await db.issues.bulkPut(toPlain(input.issues))
    if (input.logs.length > 0) await db.audits.bulkPut(toPlain(input.logs))
  })
}

/** 基准换版：把旧版本统一置为非当前 + 写入新当前版同事务提交，避免出现"没有当前基准"的中间态。 */
export async function commitBaselineVersion(input: { cleared: Baseline[]; next: Baseline }): Promise<void> {
  await db.transaction('rw', db.baselines, async () => {
    if (input.cleared.length > 0) await db.baselines.bulkPut(toPlain(input.cleared))
    await db.baselines.put(toPlain(input.next))
  })
}

export async function putPlan(row: InspectionPlan): Promise<void> {
  await db.plans.put(toPlain(row))
  announceChange()
}

export async function putTask(row: InspectionTask): Promise<void> {
  await db.tasks.put(toPlain(row))
  announceChange()
}

export async function putIssue(row: InspectionIssue): Promise<void> {
  await db.issues.put(toPlain(row))
  announceChange()
}

export async function putWorkOrder(row: WorkOrder): Promise<void> {
  await db.workOrders.put(toPlain(row))
  announceChange()
}

export async function putAttachment(row: IssueAttachment): Promise<void> {
  await db.attachments.put(toPlain(row))
  announceChange()
}

export async function deleteAttachment(id: string): Promise<void> {
  await db.attachments.delete(id)
  announceChange()
}

/**
 * 浏览器本地数据库（IndexedDB）。
 * V0.1 全部业务数据保存在本机；V2.0 以服务端接口替换本层，编号与状态含义不变。
 */
import Dexie, { type Table } from 'dexie'
import { installReceipts } from '@/core/operations/receipts'
import type { AuditLog, Baseline, Building, Device, Floor, MonitorRecord, Point } from '@/types/domain'
import type { MonitoringRule } from '@/types/rules'
import type { AlarmEvent, AlarmNotification } from '@/types/events'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'
import { linkMaintenanceIssues } from './maintenance/migrate'
import { normalizeLegacyV4Rows } from './legacy/normalize'
import type { MaintenancePlan, MaintenanceTask } from '@/types/maintenance'
import { isShowcase, SHOWCASE_DB_NAME } from '@/core/demo/workspace'

export const DB_NAME = 'zhutong-demo'

/**
 * 各版本新增/变更的对象仓库定义。
 *
 * 抽成常量是为了**能被测试直接引用**：版本升级测试要拿真实的 v4 定义建库，
 * 再让应用以 v5/v6 打开，验证旧表数据完好 —— 如果测试里另抄一份定义，就等于没验真实 schema。
 */
export const SCHEMA_V1_STORES = {
  buildings: 'id, code, status',
  floors: 'id, buildingId, status',
  points: 'id, code, buildingId, floorId, status',
  devices: 'id, code, pointId, status',
  baselines: 'id, pointId, current, version',
  records: 'id, pointId, sampleTime, recordNo',
  audits: 'id, at, objectType',
}

/** v2：预警规则独立成表，规则按版本与生效时间参与判定 */
export const SCHEMA_V2_STORES = {
  rules: 'id, code, metric, enabled',
}

/** v3：规则在同一表内按版本存多行；新增预警事件与站内通知 */
export const SCHEMA_V3_STORES = {
  rules: 'id, ruleId, code, metric, enabled',
  events: 'id, eventNo, pointId, ruleId, status, level, openedAt',
  notifications: 'id, eventId, level, createdAt',
}

export const SCHEMA_V4_STORES = {
  plans: 'id, code, buildingId, kind',
  tasks: 'id, taskNo, planId, buildingId, status, plannedAt',
  issues: 'id, issueNo, source, pointId, eventId, taskId, status, createdAt',
  workOrders: 'id, orderNo, origin, issueId, eventId, pointId, status',
  attachments: 'id, issueId, workOrderId, kind',
}

/**
 * v5：设备保养（V1-D）。**只新增表，不改旧表** —— 旧库升级不需要校验既有数据，
 * 也就不会出现"升级失败打不开库"的风险。
 */
export const SCHEMA_V5_STORES = {
  maintenancePlans: 'id, code, deviceId, buildingId, enabled',
  maintenanceTasks: 'id, taskNo, planId, deviceId, status, plannedAt',
}

/**
 * v6：附件增加**保养任务归属**。
 *
 * 必须新开一版而不是改 v5 的 attachments 定义：浏览器里可能已经打开过 v5 的库，
 * 改既有版本的索引会让 Dexie 抛 "Schema was changed" 或静默不生效；
 * 新增一版只做索引追加，Dexie 会按版本号自动升级，旧行原样保留（`maintenanceTaskId` 读作 undefined）。
 */
export const SCHEMA_V6_STORES = {
  attachments: 'id, issueId, workOrderId, maintenanceTaskId, kind',
}

/**
 * v7：问题表补 `maintenanceTaskId` 索引，让"这条保养任务转出了哪条问题"能按索引查到
 * （任务详情与一致性检查都要按它找，全表扫在数据量大时不可接受）。
 */
export const SCHEMA_V7_STORES = {
  issues: 'id, issueNo, source, pointId, eventId, taskId, maintenanceTaskId, status, createdAt',
}

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
  maintenancePlans!: Table<MaintenancePlan, string>
  maintenanceTasks!: Table<MaintenanceTask, string>

  /**
   * `name` 仅供升级测试使用：生产环境始终使用默认库名。
   * 允许测试创建隔离的旧版本库，再由**应用真实版本链**打开，避免只用另一套 Dexie 定义模拟升级。
   */
  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores(SCHEMA_V1_STORES)
    this.version(2).stores(SCHEMA_V2_STORES)
    this.version(3).stores(SCHEMA_V3_STORES)
    // v4：V0.3 巡检与维修处置；只新增表，不改动任何旧表，已有数据原样保留
    this.version(4).stores(SCHEMA_V4_STORES)
    this.version(5).stores(SCHEMA_V5_STORES)
    this.version(6).stores(SCHEMA_V6_STORES)
    /*
     * v7 升级回调里就地补迁双向关联：升级事务内读取旧行、按 submissionKey 反解任务 ID 后写回，
     * 与建索引在同一次升级里完成，因此升级后的库不存在"字段缺一半"的中间状态。
     */
    this.version(7)
      .stores(SCHEMA_V7_STORES)
      .upgrade(async (tx) => {
        const [events, plans, inspectionTasks, issues, workOrders, attachments, maintenanceTasks] = await Promise.all([
          tx.table('events').toArray() as Promise<AlarmEvent[]>,
          tx.table('plans').toArray() as Promise<InspectionPlan[]>,
          tx.table('tasks').toArray() as Promise<InspectionTask[]>,
          tx.table('issues').toArray() as Promise<InspectionIssue[]>,
          tx.table('workOrders').toArray() as Promise<WorkOrder[]>,
          tx.table('attachments').toArray() as Promise<IssueAttachment[]>,
          tx.table('maintenanceTasks').toArray() as Promise<MaintenanceTask[]>,
        ])
        const normalized = normalizeLegacyV4Rows({ events, plans, tasks: inspectionTasks, issues, workOrders, attachments })
        if (normalized.events.length > 0) await tx.table('events').bulkPut(normalized.events)
        if (normalized.plans.length > 0) await tx.table('plans').bulkPut(normalized.plans)
        if (normalized.tasks.length > 0) await tx.table('tasks').bulkPut(normalized.tasks)
        if (normalized.workOrders.length > 0) await tx.table('workOrders').bulkPut(normalized.workOrders)
        if (normalized.attachments.length > 0) await tx.table('attachments').bulkPut(normalized.attachments)
        const linked = linkMaintenanceIssues(
          [...issues.filter((row) => !normalized.issues.some((next) => next.id === row.id)), ...normalized.issues],
          maintenanceTasks,
        )
        for (const row of linked.issues) {
          if (row.maintenanceTaskId !== undefined) await tx.table('issues').put(row)
        }
        for (const row of linked.tasks) {
          if (row.execution !== null && row.execution !== undefined && row.execution.issueId !== undefined) {
            await tx.table('maintenanceTasks').put(row)
          }
        }
      })
  }
}

export const db = new ZhutongDatabase(isShowcase ? SHOWCASE_DB_NAME : DB_NAME)
installReceipts(db)

/** 清除浏览器数据会丢失本地内容，设置页需给出容量提示与备份入口。 */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage?.estimate === undefined) return null
  const estimate = await navigator.storage.estimate()
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
}

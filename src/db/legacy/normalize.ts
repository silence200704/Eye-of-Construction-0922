/**
 * 旧版巡检处置行的安全补全。
 *
 * 只给历史行补"空集合"与空关联字段，绝不猜测等级、周期、负责人等业务事实。
 * 这样即使早期本地库缺少后来增加的数组字段，页面也不会因展开 undefined 而白屏。
 */
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'

interface Normalized<T> {
  row: T
  changed: boolean
}

function withArrays<T extends Record<string, unknown>>(row: T, keys: string[]): Normalized<T> {
  const next: Record<string, unknown> = { ...row }
  let changed = false
  for (const key of keys) {
    if (!Array.isArray(next[key])) {
      next[key] = []
      changed = true
    }
  }
  return { row: next as T, changed }
}

function changedRows<T>(rows: T[], normalize: (row: T) => Normalized<T>): T[] {
  return rows.map(normalize).filter((item) => item.changed).map((item) => item.row)
}

function normalizeEvent(row: AlarmEvent): Normalized<AlarmEvent> {
  return withArrays(row as unknown as Record<string, unknown>, ['evidences', 'supersededEvidences', 'upgrades', 'timeline']) as unknown as Normalized<AlarmEvent>
}

function normalizePlan(row: InspectionPlan): Normalized<InspectionPlan> {
  return withArrays(row as unknown as Record<string, unknown>, ['floorIds', 'pointIds', 'checklist']) as unknown as Normalized<InspectionPlan>
}

function normalizeTask(row: InspectionTask): Normalized<InspectionTask> {
  return withArrays(row as unknown as Record<string, unknown>, ['results', 'issueIds']) as unknown as Normalized<InspectionTask>
}

function normalizeIssue(row: InspectionIssue): Normalized<InspectionIssue> {
  const normalized = withArrays(row as unknown as Record<string, unknown>, ['photos', 'linkedFrom', 'workOrderIds', 'rechecks', 'timeline'])
  const next = normalized.row as unknown as InspectionIssue
  if (next.maintenanceTaskId !== undefined) return { row: next, changed: normalized.changed }
  return { row: { ...next, maintenanceTaskId: null }, changed: true }
}

function normalizeWorkOrder(row: WorkOrder): Normalized<WorkOrder> {
  return withArrays(row as unknown as Record<string, unknown>, ['photos', 'reviews', 'timeline']) as unknown as Normalized<WorkOrder>
}

function normalizeAttachment(row: IssueAttachment): Normalized<IssueAttachment> {
  if (row.maintenanceTaskId !== undefined) return { row, changed: false }
  return { row: { ...row, maintenanceTaskId: null }, changed: true }
}

/** 返回需要回写的旧行；未变更的行不参与写入。 */
export function normalizeLegacyV4Rows(input: {
  events: AlarmEvent[]
  plans: InspectionPlan[]
  tasks: InspectionTask[]
  issues: InspectionIssue[]
  workOrders: WorkOrder[]
  attachments: IssueAttachment[]
}): {
  events: AlarmEvent[]
  plans: InspectionPlan[]
  tasks: InspectionTask[]
  issues: InspectionIssue[]
  workOrders: WorkOrder[]
  attachments: IssueAttachment[]
} {
  return {
    events: changedRows(input.events, normalizeEvent),
    plans: changedRows(input.plans, normalizePlan),
    tasks: changedRows(input.tasks, normalizeTask),
    issues: changedRows(input.issues, normalizeIssue),
    workOrders: changedRows(input.workOrders, normalizeWorkOrder),
    attachments: changedRows(input.attachments, normalizeAttachment),
  }
}

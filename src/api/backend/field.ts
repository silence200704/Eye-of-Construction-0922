/** 阶段 5 现场业务服务端命令：巡检、问题、工单、复查、保养、附件与报表。 */
import type { DraftPhotoInput } from '@/db/inspection/attachments'
import type {
  InspectionIssue,
  InspectionPlan,
  InspectionTask,
  WorkOrder,
  WorkOrderStatus,
} from '@/types/inspection'
import type {
  MaintenancePlan,
  MaintenanceTask,
} from '@/types/maintenance'
import { command, read } from './runtime'
import { uploadMedia } from './media'

export interface PhotoSpec {
  mediaId: string
  draftId: string
  kind: 'scene' | 'before' | 'after' | 'acceptance'
}

function shortKey(prefix: string, value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`
}

/** 照片草稿按草稿标识上传；同一草稿重试复用同一媒体，不重复占用配额。 */
export async function uploadPhotoDrafts(
  drafts: DraftPhotoInput[] | undefined,
  pointId: string | null | undefined,
  kind: PhotoSpec['kind'],
): Promise<PhotoSpec[]> {
  const specs: PhotoSpec[] = []
  for (const draft of drafts ?? []) {
    const media = await uploadMedia({
      blob: draft.blob,
      fileName: draft.fileName,
      draftId: draft.id,
      pointId: pointId ?? null,
      capturedAt: draft.capturedAt,
    })
    specs.push({ mediaId: media.id, draftId: draft.id, kind })
  }
  return specs
}

/* ---------------- 巡检计划与任务 ---------------- */

export async function fetchInspectionPlans(): Promise<InspectionPlan[]> {
  return read<InspectionPlan[]>('/inspection/plans')
}

export async function saveInspectionPlanRemote(
  draft: Record<string, unknown>,
  id: string | null,
  rev: number | undefined,
): Promise<InspectionPlan> {
  const result = await command<InspectionPlan>(id === null ? '/inspection/plans' : `/inspection/plans/${id}`, {
    method: id === null ? 'POST' : 'PATCH',
    body: { ...draft, expectedRev: rev },
    key: shortKey(`inspection_plan_${id ?? 'new'}`, { draft, rev }),
  })
  return result.data
}

export async function setInspectionPlanEnabledRemote(
  id: string, enabled: boolean, rev: number | undefined,
): Promise<InspectionPlan> {
  const result = await command<InspectionPlan>(`/inspection/plans/${id}/enabled`, {
    body: { expectedRev: rev, enabled },
    key: shortKey(`inspection_plan_enabled_${id}`, { enabled, rev }),
  })
  return result.data
}

export async function fetchInspectionTasks(): Promise<InspectionTask[]> {
  return read<InspectionTask[]>('/inspection/tasks')
}

export async function generateInspectionTasksRemote(
  day: string,
  commandKey: string,
): Promise<{ created: InspectionTask[]; skipped: number }> {
  const result = await command<{ created: InspectionTask[]; skipped: number }>(
    '/inspection/tasks/generate',
    { body: { date: day }, key: commandKey },
  )
  return result.data
}

export async function checkInTaskRemote(
  taskId: string,
  body: { expectedRev?: number; pointId: string; method: string; labelRead: string; fallbackReason: string },
): Promise<{ task: InspectionTask; attempt: Record<string, unknown> }> {
  const result = await command<{ task: InspectionTask; attempt: Record<string, unknown> }>(
    `/inspection/tasks/${taskId}/check-in`,
    { body, key: shortKey(`inspection_check_in_${taskId}`, body) },
  )
  return result.data
}

export async function completePointRemote(
  taskId: string,
  body: {
    expectedRev?: number
    pointId: string
    answers: unknown[]
    linkedIssueId: string | null
    noIssueReason: string
  },
): Promise<{ task: InspectionTask }> {
  const result = await command<{ task: InspectionTask }>(`/inspection/tasks/${taskId}/complete-point`, {
    body,
    key: shortKey(`inspection_complete_${taskId}`, body),
  })
  return result.data
}

export async function reportTaskIssueRemote(
  taskId: string,
  body: {
    expectedRev?: number
    pointId: string
    anomalyType: string
    description: string
    submissionId: string
    photos: PhotoSpec[]
  },
): Promise<{ issue: InspectionIssue; duplicated: boolean; task: InspectionTask }> {
  const result = await command<{ issue: InspectionIssue; duplicated: boolean; task: InspectionTask }>(
    `/inspection/tasks/${taskId}/issues`,
    { body, key: `inspection_issue|${body.submissionId}` },
  )
  return result.data
}

/* ---------------- 问题与复查 ---------------- */

export async function fetchIssues(): Promise<InspectionIssue[]> {
  return read<InspectionIssue[]>('/issues')
}

export async function reportIssueRemote(body: Record<string, unknown>, submissionId: string): Promise<{
  issue: InspectionIssue
  duplicated: boolean
}> {
  const result = await command<{ issue: InspectionIssue; duplicated: boolean }>('/issues', {
    body,
    key: `issue_report|${submissionId}`,
  })
  return result.data
}

export async function reviewIssueRemote(
  issueId: string,
  body: Record<string, unknown>,
): Promise<{ issue: InspectionIssue; order: WorkOrder | null }> {
  const result = await command<{ issue: InspectionIssue; order: WorkOrder | null }>(
    `/issues/${issueId}/review`,
    { body, key: shortKey(`issue_review_${issueId}`, body) },
  )
  return result.data
}

export async function registerRecheckRemote(
  issueId: string,
  body: { expectedRev?: number; subject: string; owner: string; dueDate: string },
): Promise<{ issue: InspectionIssue }> {
  const result = await command<{ issue: InspectionIssue }>(`/issues/${issueId}/rechecks`, {
    body,
    key: shortKey(`recheck_${issueId}`, body),
  })
  return result.data
}

export async function recordRecheckRemote(
  issueId: string,
  body: { expectedRev?: number; outcome: string; note: string; nextDueDate?: string },
): Promise<{ issue: InspectionIssue }> {
  const result = await command<{ issue: InspectionIssue }>(`/issues/${issueId}/rechecks/outcome`, {
    body,
    key: shortKey(`recheck_outcome_${issueId}`, body),
  })
  return result.data
}

/* ---------------- 工单 ---------------- */

export async function fetchWorkOrders(): Promise<WorkOrder[]> {
  return read<WorkOrder[]>('/work-orders')
}

export async function advanceWorkOrderRemote(
  orderId: string,
  to: WorkOrderStatus,
  body: Record<string, unknown>,
): Promise<{ order: WorkOrder; message: string }> {
  const result = await command<{ order: WorkOrder; message: string }>(
    `/work-orders/${orderId}/actions`,
    { body: { ...body, to }, key: shortKey(`order_${orderId}_${to}`, body) },
  )
  return result.data
}

/* ---------------- 保养 ---------------- */

export async function fetchMaintenancePlans(): Promise<MaintenancePlan[]> {
  return read<MaintenancePlan[]>('/maintenance/plans')
}

export async function saveMaintenancePlanRemote(
  body: Record<string, unknown>,
  id: string | null,
  rev: number | undefined,
): Promise<MaintenancePlan> {
  const result = await command<MaintenancePlan>(
    id === null ? '/maintenance/plans' : `/maintenance/plans/${id}`,
    {
      method: id === null ? 'POST' : 'PATCH',
      body: { ...body, expectedRev: rev },
      key: shortKey(`maintenance_plan_${id ?? 'new'}`, { body, rev }),
    },
  )
  return result.data
}

export async function setMaintenancePlanEnabledRemote(
  id: string, enabled: boolean, rev: number | undefined,
): Promise<MaintenancePlan> {
  const result = await command<MaintenancePlan>(`/maintenance/plans/${id}/enabled`, {
    body: { expectedRev: rev, enabled },
    key: shortKey(`maintenance_enabled_${id}`, { enabled, rev }),
  })
  return result.data
}

export async function fetchMaintenanceTasks(): Promise<MaintenanceTask[]> {
  return read<MaintenanceTask[]>('/maintenance/tasks')
}

export async function generateMaintenanceRemote(
  day: string,
  commandKey: string,
): Promise<{ created: MaintenanceTask[]; skipped: number }> {
  const result = await command<{ created: MaintenanceTask[]; skipped: number }>(
    '/maintenance/tasks/generate',
    { body: { date: day }, key: commandKey },
  )
  return result.data
}

export async function executeMaintenanceRemote(
  taskId: string,
  body: Record<string, unknown>,
): Promise<{ task: MaintenanceTask; issue: InspectionIssue | null }> {
  const result = await command<{ task: MaintenanceTask; issue: InspectionIssue | null }>(
    `/maintenance/tasks/${taskId}/execute`,
    { body, key: `maintenance_execute|${taskId}|${String(body.expectedRev ?? '')}` },
  )
  return result.data
}

/* ---------------- 报表 ---------------- */

export interface ReportExclusion {
  label: string
  count: number
  samples: string[]
}

export interface ReportIndicator {
  key: string
  name: string
  definition: string
  kind: 'ratio' | 'hours'
  numerator: { label: string; value: number }
  denominator: { label: string; value: number }
  value: number | null
  extra: string
  exclusions: ReportExclusion[]
}

export interface ReportExport {
  kind: string
  header: string[]
  rows: string[][]
  count: number
  from: string
  to: string
}

export interface EventReportData {
  eventId: string
  eventNo: string
  title: string
  closed: boolean
  sections: { title: string; question: string; rows: { label: string; value: string }[] }[]
  timeline: { at: string; by: string; action: string; detail: string }[]
}

export async function fetchIndicators(
  params: Record<string, string>,
): Promise<{ indicators: ReportIndicator[] }> {
  return read<{ indicators: ReportIndicator[] }>('/reports/indicators', params)
}

export async function fetchReportExport(
  kind: string,
  params: Record<string, string>,
): Promise<ReportExport> {
  return read<ReportExport>('/reports/export', { kind, ...params })
}

export async function fetchEventReport(eventId: string): Promise<EventReportData> {
  return read<EventReportData>(`/reports/events/${eventId}`)
}

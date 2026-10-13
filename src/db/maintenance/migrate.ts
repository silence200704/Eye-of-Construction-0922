/**
 * 保养 → 问题关联的补迁（v7）。
 *
 * 旧库（v6 及以前）的记录没有这一对反向字段：问题不知道自己是哪条保养任务转出来的，
 * 任务的执行记录也不知道自己转出过哪条问题。两者只能靠"问题池里按来源筛选"，跳不过去。
 * 补迁规则是确定性的：保养转出的问题 `submissionKey` 形如 `mt_<任务ID>`，据此反解即可，
 * 不需要人工确认，也不会猜错。
 */
import type { InspectionIssue } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'

const PREFIX = 'mt_'

export interface MaintenanceLinkResult {
  issues: InspectionIssue[]
  tasks: MaintenanceTask[]
  changed: number
}

/** 由问题的 submissionKey 反解来源保养任务；不是保养来源或格式不符时返回 null。 */
export function maintenanceTaskIdOf(issue: Pick<InspectionIssue, 'source' | 'submissionKey'>): string | null {
  const key = typeof issue.submissionKey === 'string' ? issue.submissionKey : ''
  if (issue.source !== 'maintenance' || !key.startsWith(PREFIX)) return null
  const taskId = key.slice(PREFIX.length)
  return taskId === '' ? null : taskId
}

/**
 * 双向补齐：先按 submissionKey 补问题的 `maintenanceTaskId`，
 * 再用它把任务的 `execution.issueId` 补上。已经写好的字段不动（不覆盖用户/程序后来的修正）。
 */
export function linkMaintenanceIssues(issues: InspectionIssue[], tasks: MaintenanceTask[]): MaintenanceLinkResult {
  let changed = 0
  const issueRows: InspectionIssue[] = []
  const byTask = new Map<string, string>()
  for (const issue of issues) {
    const linked = issue.maintenanceTaskId ?? maintenanceTaskIdOf(issue)
    if (issue.maintenanceTaskId === undefined && linked !== null) changed += 1
    issueRows.push(issue.maintenanceTaskId === undefined ? { ...issue, maintenanceTaskId: linked } : issue)
    if (linked !== null) byTask.set(linked, issue.id)
  }
  const taskRows: MaintenanceTask[] = []
  for (const task of tasks) {
    const execution = task.execution
    if (execution === null || execution === undefined || execution.issueId !== undefined) {
      taskRows.push(task)
      continue
    }
    const issueId = byTask.get(task.id) ?? null
    if (issueId !== null) changed += 1
    taskRows.push({ ...task, execution: { ...execution, issueId } })
  }
  return { issues: issueRows, tasks: taskRows, changed }
}

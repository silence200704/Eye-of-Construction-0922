/** 巡检任务的服务端写入：到点、完成与巡检问题上报。 */
import type { ChecklistAnswer, InspectionIssue, InspectionTask } from '@/types/inspection'
import type { InspectionDraft } from '../tasks'
import {
  checkInTaskRemote,
  completePointRemote,
  generateInspectionTasksRemote,
  reportTaskIssueRemote,
  uploadPhotoDrafts,
} from '@/api/backend/field'
import { uid } from '@/core/id'

export async function generateTasksRemote(day: string, commandKey: string): Promise<{
  created: InspectionTask[]
  skipped: number
}> {
  return generateInspectionTasksRemote(day, commandKey)
}

export async function checkInRemote(
  task: InspectionTask,
  pointId: string,
  input: { method: string; labelRead: string; fallbackReason: string },
): Promise<InspectionTask> {
  const out = await checkInTaskRemote(task.id, {
    expectedRev: task.rev,
    pointId,
    method: input.method,
    labelRead: input.labelRead,
    fallbackReason: input.fallbackReason,
  })
  return out.task
}

export async function completePointRemoteSubmit(
  task: InspectionTask,
  pointId: string,
  payload: { answers: ChecklistAnswer[]; linkedIssueId: string | null; noIssueReason: string },
): Promise<InspectionTask> {
  const out = await completePointRemote(task.id, {
    expectedRev: task.rev,
    pointId,
    answers: payload.answers,
    linkedIssueId: payload.linkedIssueId,
    noIssueReason: payload.noIssueReason,
  })
  return out.task
}

export async function submitTaskIssueRemote(
  task: InspectionTask,
  pointId: string,
  draft: InspectionDraft,
  pending: Map<string, string>,
  reuseSubmissionId: string | null = null,
): Promise<{ issue: InspectionIssue; duplicated: boolean }> {
  const reuse = draft.reuseIssueId ?? null
  const fingerprint = [
    task.id,
    pointId,
    draft.anomalyType,
    draft.description,
    reuse ?? '',
    (draft.photoDrafts ?? []).map((row) => row.id).join(','),
  ].join('|')
  let submissionId = reuseSubmissionId ?? pending.get(fingerprint)
  if (submissionId === undefined) {
    submissionId = uid('task_submission')
    pending.set(fingerprint, submissionId)
  }
  const photos = await uploadPhotoDrafts(draft.photoDrafts, pointId, 'scene')
  const out = await reportTaskIssueRemote(task.id, {
    expectedRev: task.rev,
    pointId,
    anomalyType: draft.anomalyType,
    description: draft.description,
    submissionId,
    photos,
  })
  pending.delete(fingerprint)
  return out
}

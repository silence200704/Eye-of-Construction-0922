/** 问题上报的服务端写入：照片先按草稿上传，再以 submissionId 幂等提交。 */
import type { InspectionIssue } from '@/types/inspection'
import type { IssueDraft, ReviewPayload } from '../issues'
import {
  reportIssueRemote,
  reviewIssueRemote,
  uploadPhotoDrafts,
} from '@/api/backend/field'
import { uid } from '@/core/id'

export interface RemoteIssueResult {
  issue: InspectionIssue
  duplicated: boolean
}

function fingerprint(draft: IssueDraft): string {
  return [
    draft.source,
    draft.pointId ?? '',
    draft.buildingId,
    draft.anomalyType,
    draft.description,
    draft.eventId ?? '',
    (draft.photoDrafts ?? []).map((row) => row.id).join(','),
  ].join('|')
}

export async function submitIssueRemote(
  draft: IssueDraft,
  pending: Map<string, string>,
): Promise<RemoteIssueResult> {
  const key = fingerprint(draft)
  let submissionId = pending.get(key)
  if (submissionId === undefined) {
    submissionId = uid('submission')
    pending.set(key, submissionId)
  }
  const photos = await uploadPhotoDrafts(draft.photoDrafts, draft.pointId, 'scene')
  const out = await reportIssueRemote(
    {
      source: draft.source === 'sensor' ? 'sensor' : 'report',
      pointId: draft.pointId,
      buildingId: draft.buildingId,
      floorId: draft.floorId,
      zoneId: draft.zoneId,
      anomalyType: draft.anomalyType,
      description: draft.description,
      submissionId,
      eventId: draft.eventId ?? null,
      photos,
    },
    submissionId,
  )
  pending.delete(key)
  return out
}

export async function reviewIssueRemoteSubmit(
  issue: InspectionIssue,
  input: ReviewPayload,
): Promise<InspectionIssue> {
  const photos = await uploadPhotoDrafts(input.photoDrafts, issue.pointId, 'scene')
  const out = await reviewIssueRemote(issue.id, {
    expectedRev: issue.rev,
    action: input.action,
    category: input.category,
    note: input.note,
    duplicateOf: input.duplicateOf ?? null,
    linkedEventId: input.linkedEventId ?? null,
    photos,
    noPhotoReason: input.noPhotoReason ?? '',
  })
  return out.issue
}

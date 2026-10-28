import { ReportTarget, IssueRecord } from '../../data/models/Reports';
import { ReportDraft } from './ReportDraft';

export interface PhotoPreview {
  draftId: string;
  uri: string;
  size: number;
  source: string;
  mediaId: string;
  sha256: string;
}

export class DraftPreview {
  target: ReportTarget;
  submissionId: string;
  anomalyType: string;
  description: string;
  photos: PhotoPreview[];

  constructor(draft: ReportDraft) {
    this.target = { pointId: draft.target.pointId, buildingId: draft.target.buildingId,
      floorId: draft.target.floorId, taskId: draft.target.taskId, expectedRev: draft.target.expectedRev };
    this.submissionId = draft.submissionId; this.anomalyType = draft.anomalyType; this.description = draft.description;
    this.photos = draft.photos.map((photo): PhotoPreview => ({ draftId: photo.prepared.draftId,
      uri: photo.prepared.uri, size: photo.prepared.bytes.byteLength, source: photo.prepared.source,
      mediaId: photo.mediaId, sha256: photo.sha256 }));
  }
}

export class ReportView {
  draft: DraftPreview | null = null;
  phase: string = 'idle';
  message: string = '';
  issue: IssueRecord | null = null;
}

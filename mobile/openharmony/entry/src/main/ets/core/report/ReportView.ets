import { ReportTarget, IssueRecord, copyTarget } from '../../data/models/Reports';
import { WorkOrder } from '../../data/models/Tasks';
import { ReportDraft } from './ReportDraft';

export interface PhotoPreview {
  draftId: string;
  uri: string;
  size: number;
  source: string;
  mediaId: string;
  sha256: string;
  kind: string;
}

export class DraftPreview {
  target: ReportTarget;
  submissionId: string;
  anomalyType: string;
  description: string;
  photos: PhotoPreview[];
  note: string;
  measures: string;
  materials: string;

  constructor(draft: ReportDraft) {
    this.target = copyTarget(draft.target);
    this.submissionId = draft.submissionId; this.anomalyType = draft.anomalyType; this.description = draft.description;
    this.photos = draft.photos.map((photo): PhotoPreview => ({ draftId: photo.prepared.draftId,
      uri: photo.prepared.uri, size: photo.prepared.bytes.byteLength, source: photo.prepared.source,
      mediaId: photo.mediaId, sha256: photo.sha256, kind: photo.kind }));
    this.note = draft.note; this.measures = draft.measures; this.materials = draft.materials;
  }
}

export class ReportView {
  draft: DraftPreview | null = null;
  phase: string = 'idle';
  message: string = '';
  issue: IssueRecord | null = null;
  order: WorkOrder | null = null;
}

import { InspectionTask } from './Tasks';

export interface ReportTarget {
  pointId: string;
  buildingId: string;
  floorId: string;
  taskId: string;
  expectedRev: number;
}

export interface PreparedPhoto {
  draftId: string;
  bytes: ArrayBuffer;
  uri: string;
  fileName: string;
  mimeType: string;
  source: string;
}

export class ReportPhoto {
  prepared: PreparedPhoto;
  mediaId: string = '';
  sha256: string = '';
  constructor(photo: PreparedPhoto) { this.prepared = photo; }
  copy(): ReportPhoto {
    const result = new ReportPhoto(this.prepared);
    result.mediaId = this.mediaId; result.sha256 = this.sha256;
    return result;
  }
}

export interface MediaResult { id: string; size: number; sha256: string; }
export interface PhotoLink { mediaId: string; draftId: string; kind: string; }
export interface ReportBody {
  pointId: string | null;
  buildingId?: string;
  floorId?: string;
  source?: string;
  expectedRev?: number;
  anomalyType: string;
  description: string;
  submissionId: string;
  photos: PhotoLink[];
}

export interface IssueRecord {
  id: string;
  issueNo: string;
  pointId: string | null;
  buildingId: string;
  taskId: string | null;
  anomalyType: string;
  description: string;
  status: string;
  reviewAction?: string | null;
  reviewNote?: string;
  photos: string[];
  rev: number;
}

export interface ReportResult {
  issue: IssueRecord;
  task?: InspectionTask;
}

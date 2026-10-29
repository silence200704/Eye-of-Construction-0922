import { InspectionTask, WorkOrder } from './Tasks';

export interface ReportTarget {
  pointId: string;
  buildingId: string;
  floorId: string;
  taskId: string;
  expectedRev: number;
  issueId?: string;
  orderId?: string;
  action?: string;
  existingPhotoCount?: number;
  existingPhotoBytes?: number;
  requirePhoto?: boolean;
  requireNote?: boolean;
}

export function copyTarget(target: ReportTarget): ReportTarget {
  return { pointId: target.pointId, buildingId: target.buildingId, floorId: target.floorId, taskId: target.taskId,
    expectedRev: target.expectedRev, issueId: target.issueId, orderId: target.orderId, action: target.action,
    existingPhotoCount: target.existingPhotoCount, existingPhotoBytes: target.existingPhotoBytes,
    requirePhoto: target.requirePhoto, requireNote: target.requireNote };
}

export interface PreparedPhoto {
  draftId: string;
  bytes: ArrayBuffer;
  uri: string;
  fileName: string;
  mimeType: string;
  source: string;
  cachePath?: string;
}

export class ReportPhoto {
  prepared: PreparedPhoto;
  mediaId: string = '';
  sha256: string = '';
  kind: string = 'scene';
  constructor(photo: PreparedPhoto) { this.prepared = photo; }
  copy(): ReportPhoto {
    const result = new ReportPhoto(this.prepared);
    result.mediaId = this.mediaId; result.sha256 = this.sha256;
    result.kind = this.kind;
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
  floorId?: string | null;
  createdById?: string | null;
  taskId: string | null;
  source?: string;
  anomalyType: string;
  description: string;
  status: string;
  reviewAction?: string | null;
  reviewNote?: string;
  photos: string[];
  rev: number;
}

export interface ReportResult {
  issue?: IssueRecord;
  order?: WorkOrder;
  task?: InspectionTask;
}

export interface HandlingBody {
  expectedRev: number;
  note: string;
  photos: PhotoLink[];
  to?: string;
  measures?: string;
  materials?: string;
}

export interface HandlingContext {
  issue?: IssueRecord;
  order?: WorkOrder;
  buildingId?: string;
  existingPhotoCount: number;
  existingPhotoBytes: number;
}

import { ReportTarget } from '../../../data/models/Reports';

export interface DurablePhoto {
  draftId: string; path: string; uri: string; fileName: string; mimeType: string;
  source: string; size: number; sha256: string;
}
export interface OfflineReport {
  id: string; scope: string; target: ReportTarget; anomalyType: string; description: string;
  photos: DurablePhoto[]; phase: string; updatedAt: string;
}
export interface UploadedPhoto { draftId: string; mediaId: string; sha256: string; }
export interface OfflineOperation {
  id: string; scope: string; request: OfflineReport; phase: string; uploaded: UploadedPhoto[];
  commitKey: string; commitBody: string; attempts: number; nextAttemptAt: number;
  uncertain: boolean;
  message: string; issueId: string; issueNo: string;
}
export interface DurableReader { read: (photo: DurablePhoto) => Promise<ArrayBuffer>; }

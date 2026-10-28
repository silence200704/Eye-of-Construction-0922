import { ReportTarget, PreparedPhoto, ReportPhoto, ReportBody, PhotoLink } from '../../data/models/Reports';

export function reportId(): string { return `report-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export class ReportDraft {
  target: ReportTarget;
  submissionId: string = reportId();
  anomalyType: string = '';
  description: string = '';
  photos: ReportPhoto[] = [];

  constructor(target: ReportTarget) {
    this.target = { pointId: target.pointId, buildingId: target.buildingId, floorId: target.floorId,
      taskId: target.taskId, expectedRev: target.expectedRev };
  }

  copy(): ReportDraft {
    const result = new ReportDraft(this.target);
    result.submissionId = this.submissionId; result.anomalyType = this.anomalyType;
    result.description = this.description; result.photos = this.photos.map((photo) => photo.copy());
    return result;
  }

  add(photo: PreparedPhoto): void {
    if (this.photos.length >= 3) throw new Error('每次上报最多3张照片。');
    if (!photo.bytes.byteLength || this.photos.reduce((size, row) => size + row.prepared.bytes.byteLength, photo.bytes.byteLength) > 600 * 1024) {
      throw new Error('照片合计需不超过600 KB，请重新选择或压缩。');
    }
    if (this.photos.some((row) => row.prepared.draftId === photo.draftId)) throw new Error('请勿重复添加同一照片。');
    this.photos.push(new ReportPhoto(photo));
  }

  validate(): string {
    if (this.photos.some((photo) => !photo.mediaId)) return '照片尚未上传完成；上传后才可关联问题。';
    if (!this.target.buildingId) return '请先选择实际楼栋或测点。';
    if (!this.anomalyType.trim() || !this.description.trim()) return '请填写异常类型和现场描述。';
    return '';
  }

  body(): string {
    const body: ReportBody = { pointId: this.target.pointId || null, anomalyType: this.anomalyType.trim(),
      description: this.description.trim(), submissionId: this.submissionId,
      photos: this.photos.map((photo): PhotoLink => ({ mediaId: photo.mediaId, draftId: photo.prepared.draftId, kind: 'scene' })) };
    if (this.target.taskId) body.expectedRev = this.target.expectedRev;
    else { body.source = 'report'; body.buildingId = this.target.buildingId; body.floorId = this.target.floorId; }
    return JSON.stringify(body);
  }
}

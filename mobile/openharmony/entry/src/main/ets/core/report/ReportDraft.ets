import { ReportTarget, PreparedPhoto, ReportPhoto, ReportBody, PhotoLink, HandlingBody, copyTarget } from '../../data/models/Reports';

export function reportId(): string { return `report-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export class ReportDraft {
  target: ReportTarget;
  submissionId: string = reportId();
  anomalyType: string = '';
  description: string = '';
  photos: ReportPhoto[] = [];
  note: string = '';
  measures: string = '';
  materials: string = '';

  constructor(target: ReportTarget) {
    this.target = copyTarget(target);
  }

  copy(): ReportDraft {
    const result = new ReportDraft(this.target);
    result.submissionId = this.submissionId; result.anomalyType = this.anomalyType;
    result.description = this.description; result.photos = this.photos.map((photo) => photo.copy());
    result.note = this.note; result.measures = this.measures; result.materials = this.materials;
    return result;
  }

  add(photo: PreparedPhoto): void {
    if (this.photos.length + (this.target.existingPhotoCount ?? 0) >= 3) throw new Error('同一业务对象最多3张照片，已有照片也占配额。');
    if (!photo.bytes.byteLength || this.photos.reduce((size, row) => size + row.prepared.bytes.byteLength,
      photo.bytes.byteLength + (this.target.existingPhotoBytes ?? 0)) > 600 * 1024) {
      throw new Error('照片合计需不超过600 KB，请重新选择或压缩。');
    }
    if (this.photos.some((row) => row.prepared.draftId === photo.draftId)) throw new Error('请勿重复添加同一照片。');
    const entry = new ReportPhoto(photo); entry.kind = this.target.orderId ? 'after' : 'scene';
    this.photos.push(entry);
  }

  validate(): string {
    if (this.photos.some((photo) => !photo.mediaId)) return '照片尚未上传完成；上传后才可关联问题。';
    return this.validateText();
  }

  validateText(): string {
    if (this.target.issueId) {
      if (this.note.trim().length < 10) return '补充说明至少10字；原始记录保持不变。';
      if (this.target.requirePhoto && this.photos.length === 0) return '审核要求补充图片，请选择新的照片。';
      return '';
    }
    if (this.target.orderId) {
      if (this.target.requireNote && !this.note.trim()) return '物业代接必须填写原因。';
      if (this.target.action === 'submitted' && !this.measures.trim()) return '提交完工必须填写维修措施。';
      return '';
    }
    if (!this.target.buildingId) return '请先选择实际楼栋或测点。';
    if (!this.anomalyType.trim() || !this.description.trim()) return '请填写异常类型和现场描述。';
    return '';
  }

  body(): string {
    const photos = this.photos.map((photo): PhotoLink => ({ mediaId: photo.mediaId, draftId: photo.prepared.draftId, kind: photo.kind }));
    if (this.target.issueId || this.target.orderId) {
      const handling: HandlingBody = { expectedRev: this.target.expectedRev, note: this.note.trim(), photos };
      if (this.target.orderId) {
        handling.to = this.target.action;
        if (this.target.action === 'submitted') { handling.measures = this.measures.trim(); handling.materials = this.materials.trim(); }
      }
      return JSON.stringify(handling);
    }
    const body: ReportBody = { pointId: this.target.pointId || null, anomalyType: this.anomalyType.trim(),
      description: this.description.trim(), submissionId: this.submissionId,
      photos };
    if (this.target.taskId) body.expectedRev = this.target.expectedRev;
    else { body.source = 'report'; body.buildingId = this.target.buildingId; body.floorId = this.target.floorId; }
    return JSON.stringify(body);
  }
}

import { TaskAccess } from '../field/TaskCommander';
import { ReportLease } from '../report/ReportLease';
import { ReportTarget } from '../../data/models/Reports';
import { ApiError } from '../network/ApiError';

interface AttachmentRow { id: string; issueId: string | null; workOrderId: string | null; mediaId: string; size: number; kind: string; }
export interface PhotoOpen { attachmentId: string; issueId?: string; orderId?: string; }
export interface SavedPhoto { uri: string; kind: string; }
export interface PreviewFiles { write: (bytes: ArrayBuffer) => string; remove: (uri: string) => void; }
export interface ReaderOptions { access: () => TaskAccess | null; files: PreviewFiles; }

export class PhotoReader {
  private options: ReaderOptions;
  private generation: number = 0;
  private uris: string[] = [];
  constructor(options: ReaderOptions) { this.options = options; }
  clear(): void { this.generation++; this.uris.forEach((uri) => this.options.files.remove(uri)); this.uris = []; }
  async open(request: PhotoOpen): Promise<SavedPhoto> {
    const access = this.options.access(); if (!access) throw new ApiError('CANCELLED', '照片读取已失效。');
    const generation = this.generation;
    const issue = access.workspace.issues.find((row) => row.id === request.issueId);
    const order = access.workspace.orders.find((row) => row.id === request.orderId);
    if (!issue && !order) throw new ApiError('NOT_FOUND', '当前对象不可查看。');
    const related = issue ?? access.workspace.issues.find((row) => row.id === order?.issueId);
    const point = access.workspace.points.find((row) => row.id === (issue?.pointId ?? order?.pointId));
    const target: ReportTarget = { issueId: request.issueId, orderId: request.orderId, pointId: point?.id ?? '',
      buildingId: point?.buildingId ?? related?.buildingId ?? '', floorId: point?.floorId ?? '', taskId: '', expectedRev: issue?.rev ?? order?.rev ?? 0 };
    const lease = new ReportLease(access, this.options.access); await lease.authorize(target);
    const response = await access.client.send<AttachmentRow[]>('/datasets/demo-main/attachments');
    if (response.meta?.datasetEpoch !== access.workspace.epoch || !Array.isArray(response.data)) throw new ApiError('EPOCH_CHANGED', '数据已变化。');
    const row = response.data.find((item) => item.id === request.attachmentId &&
      (request.orderId ? item.workOrderId === request.orderId : item.issueId === request.issueId));
    if (!row || row.size > 600 * 1024 || row.size < 1) throw new ApiError('NOT_FOUND', '照片不属于当前对象或超出配额。');
    if (!access.client.readBinary) throw new ApiError('UNAVAILABLE', '当前连接不能读取照片。');
    await lease.authorize(target);
    if (generation !== this.generation) throw new ApiError('CANCELLED', '照片读取已取消。');
    const bytes = await access.client.readBinary(`/datasets/demo-main/media/${encodeURIComponent(row.mediaId)}/content`);
    await lease.authorize(target);
    if (generation !== this.generation || bytes.byteLength !== row.size) throw new ApiError('CANCELLED', '照片读取已失效或内容不完整。');
    const uri = this.options.files.write(bytes);
    try {
      await lease.authorize(target);
      if (generation !== this.generation) throw new ApiError('CANCELLED', '照片读取已取消。');
      this.uris.push(uri); return { uri, kind: row.kind };
    } catch (cause) { this.options.files.remove(uri); throw cause; }
  }
}

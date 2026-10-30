import { OutboxStore } from './OutboxStore';
import { OfflineOperation, DurableReader } from './QueueModels';
import { OfflinePack, scopeKey } from '../OfflineModels';
import { TaskAccess } from '../../field/TaskCommander';
import { ReportLease } from '../../report/ReportLease';
import { MediaResult, ReportResult, ReportBody, PhotoLink } from '../../../data/models/Reports';
import { ApiError, errorMessage } from '../../network/ApiError';

const RUNNING: Set<string> = new Set();
export interface ExecutorOptions {
  store: OutboxStore; files: DurableReader; access: () => TaskAccess | null; now?: () => number;
  onResult?: (result: ReportResult) => void;
}
export class OutboxExecutor {
  private options: ExecutorOptions;
  private stopped: boolean = false;
  constructor(options: ExecutorOptions) { this.options = options; }
  stop(): void { this.stopped = true; }
  private now(): number { return this.options.now ? this.options.now() : Date.now(); }
  private async upload(pack: OfflinePack, op: OfflineOperation, lease: ReportLease): Promise<void> {
    for (const photo of op.request.photos) {
      if (op.uploaded.some((row) => row.draftId === photo.draftId)) continue;
      await lease.authorize(op.request.target);
      if (this.stopped) throw new ApiError('CANCELLED', '同步已暂停，原请求保留。');
      const bytes = await this.options.files.read(photo);
      await lease.authorize(op.request.target);
      if (this.stopped) throw new ApiError('CANCELLED', '同步已暂停，原请求保留。');
      op.phase = 'uploading'; op.uncertain = true; await this.options.store.progress(pack, op);
      const response = await lease.access.client.send<MediaResult>(`/datasets/demo-main/media?fileName=${encodeURIComponent(photo.fileName)}&pointId=${encodeURIComponent(op.request.target.pointId)}`, {
        method: 'POST', body: bytes, contentType: 'image/jpeg', idempotencyKey: `${op.id}-photo-${photo.draftId}`, datasetEpoch: pack.workspace.epoch });
      await lease.authorize(op.request.target);
      if (this.stopped) throw new ApiError('CANCELLED', '同步已暂停，原请求保留。');
      if (response.meta?.datasetEpoch !== pack.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '数据已复位，旧队列已隔离。');
      if (!response.data.id || response.data.size !== photo.size || response.data.sha256 !== photo.sha256) {
        throw new ApiError('INVALID_RESPONSE', '照片回执不完整或哈希不一致，请用原照片核验。');
      }
      op.uploaded.push({ draftId: photo.draftId, mediaId: response.data.id, sha256: response.data.sha256 });
      op.uncertain = false;
      await this.options.store.progress(pack, op);
    }
  }
  private async commit(pack: OfflinePack, op: OfflineOperation, lease: ReportLease): Promise<void> {
    if (!op.commitBody) {
      const body: ReportBody = { source: 'report', pointId: op.request.target.pointId, buildingId: op.request.target.buildingId,
        floorId: op.request.target.floorId, anomalyType: op.request.anomalyType.trim(), description: op.request.description.trim(),
        submissionId: op.id, photos: op.request.photos.map((photo): PhotoLink => ({ draftId: photo.draftId,
          mediaId: op.uploaded.find((row) => row.draftId === photo.draftId)!.mediaId, kind: 'scene' })) };
      op.commitBody = JSON.stringify(body);
    }
    op.phase = 'sending'; op.uncertain = true; op.message = '等待服务端确认，原请求已固定。';
    await this.options.store.progress(pack, op);
    await lease.authorize(op.request.target);
    if (this.stopped) throw new ApiError('CANCELLED', '同步已暂停，原请求保留。');
    const response = await lease.access.client.send<ReportResult>('/datasets/demo-main/issues', {
      method: 'POST', body: op.commitBody, idempotencyKey: op.commitKey, datasetEpoch: pack.workspace.epoch });
    await lease.authorize(op.request.target);
    if (this.stopped) throw new ApiError('CANCELLED', '同步已暂停，原请求保留。');
    if (response.meta?.datasetEpoch !== pack.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '数据版本已变化，旧操作已隔离。');
    const issue = response.data.issue;
    if (!issue?.id || !issue.issueNo || issue.pointId !== op.request.target.pointId || issue.buildingId !== op.request.target.buildingId ||
      !Number.isInteger(issue.rev) || !Array.isArray(issue.photos)) throw new ApiError('INVALID_RESPONSE', '上报回执不完整，请用原请求核验。');
    op.phase = 'done'; op.uncertain = false; op.issueId = issue.id; op.issueNo = issue.issueNo;
    op.message = `服务端已确认 ${issue.issueNo}；问题尚未关闭。`;
    await this.options.store.progress(pack, op);
    if (!this.stopped && lease.current()) this.options.onResult?.(response.data);
  }
  private async failed(pack: OfflinePack, op: OfflineOperation, cause: Error): Promise<void> {
    const error = cause as ApiError;
    if (['EPOCH_CHANGED', 'DATASET_EPOCH_CONFLICT', 'OFFLINE_SCOPE_CHANGED'].includes(error.code)) op.phase = 'isolated';
    else if ([401, 403].includes(error.status) || ['AUTHORIZATION_CHANGED', 'CANCELLED'].includes(error.code)) op.phase = 'blocked';
    else if (error.status === 409) op.phase = 'conflict';
    else if (['PHOTO_INTEGRITY', 'PHOTO_PATH', 'PHOTO_SIZE', 'PHOTO_ID'].includes(error.code)) op.phase = 'failed';
    else if (error.status >= 400 && error.status < 500) op.phase = 'failed';
    else { op.phase = 'waiting'; op.nextAttemptAt = this.now() + Math.min(60000, Math.pow(2, op.attempts) * 1000); }
    op.message = op.phase === 'waiting' ? op.uncertain ? '同步结果待核验；原照片与原请求已保留，请稍后重试，不另建重复操作。' :
      '尚未发出上传或提交，请恢复连接后用原操作继续。' : errorMessage(error as Error);
    await this.options.store.progress(pack, op);
  }
  async sync(pack: OfflinePack, id: string): Promise<void> {
    if (this.stopped || RUNNING.has(pack.scope)) return;
    RUNNING.add(pack.scope);
    try {
      const op = await this.options.store.operation(pack, id);
      if (['done', 'conflict', 'failed', 'isolated'].includes(op.phase) || op.attempts >= 5 || op.nextAttemptAt > this.now()) return;
      const access = this.options.access();
      if (!access || scopeKey({ baseUrl: access.baseUrl, user: access.user, workspace: access.workspace }) !== pack.scope) return;
      const lease = new ReportLease(access, this.options.access);
      op.attempts++; await this.options.store.progress(pack, op);
      try {
        await this.upload(pack, op, lease);
        await this.commit(pack, op, lease);
      } catch (cause) { if (!this.stopped && op.phase !== 'done') await this.failed(pack, op, cause as Error); }
    } finally { RUNNING.delete(pack.scope); }
  }
}

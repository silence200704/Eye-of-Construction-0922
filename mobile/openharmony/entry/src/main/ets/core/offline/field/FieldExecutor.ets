import { TaskAccess } from '../../field/TaskCommander';
import { FieldOperation, FieldResult } from './FieldModels';
import { FieldQueue } from './FieldQueue';
import { DurableReader } from '../queue/QueueModels';
import { scopeKey } from '../OfflineModels';
import { BusinessResult } from '../../business/BusinessModels';
import { uploadBusinessPhotos } from '../../business/BusinessPhotos';
import { Identity } from '../../../data/models/Identity';
import { authorizationOf } from '../../identity/authorization';
import { ApiError, errorMessage } from '../../network/ApiError';
export interface FieldOptions { queue: FieldQueue; access: () => TaskAccess | null; files: DurableReader; onResult: (result: BusinessResult) => void; }
const RUNNING: Set<string> = new Set();
export class FieldExecutor {
  private options: FieldOptions;
  private stopped: boolean = false;
  constructor(options: FieldOptions) { this.options = options; }
  stop(): void { this.stopped = true; }
  private current(scope: string): TaskAccess {
    const access = this.options.access();
    if (this.stopped || !access || scopeKey({ baseUrl: access.baseUrl, user: access.user, workspace: access.workspace }) !== scope) {
      throw new ApiError('AUTHORIZATION_CHANGED', '当前身份或数据版本变化，队列已暂停。', 403);
    }
    return access;
  }
  async sync(scope: string): Promise<void> {
    if (RUNNING.has(scope)) return;
    RUNNING.add(scope);
    try {
      for (const item of await this.options.queue.list(scope)) {
        if (this.stopped) break;
        if (item.attempts >= 5 || item.nextAttempt > Date.now()) continue;
        const row = await this.options.queue.prepare(item.id, scope);
        if (row) await this.send(row);
      }
    } finally { RUNNING.delete(scope); }
  }
  private async authorize(row: FieldOperation): Promise<TaskAccess> {
    const access = this.current(row.scope);
    const principal = await access.client.send<Identity>('/auth/me');
    if (this.current(row.scope).client !== access.client || authorizationOf(principal.data) !== authorizationOf(access.user)) {
      throw new ApiError('AUTHORIZATION_CHANGED', '服务端授权已变化。', 403);
    }
    return access;
  }
  private async send(row: FieldOperation): Promise<void> {
    try {
      const access = await this.authorize(row); row.attempts++;
      await this.options.queue.update(row);
      if (row.photos.some((photo) => !photo.mediaId)) {
        row.phase = 'uploading'; await this.options.queue.update(row);
        await uploadBusinessPhotos(row.photos, { access, current: this.options.access, files: this.options.files,
          save: async () => this.options.queue.update(row) });
        const prepared = await this.options.queue.prepare(row.id, row.scope); if (!prepared) return; row = prepared;
      }
      await this.authorize(row); row.phase = 'sending'; row.sent = true; await this.options.queue.update(row);
      this.current(row.scope);
      const response = await access.client.send<BusinessResult>(`/datasets/demo-main${row.write.path}`, {
        method: 'POST', body: row.body, idempotencyKey: row.key, datasetEpoch: access.workspace.epoch });
      await this.authorize(row);
      if (response.meta?.datasetEpoch !== access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '演示数据已复位。', 409);
      const facts = response.data as Object as FieldResult;
      const target = row.write.kind === 'order' ? facts.order : row.write.kind === 'issue' ? facts.issue : facts.task;
      if (!target?.id || !Number.isInteger(target.rev) || (row.write.targetId && target.id !== row.write.targetId)) throw new Error('服务端结果不完整，请核验原请求。');
      row.result = JSON.stringify(response.data); row.phase = 'done'; row.message = facts.attempt?.passed === false ? '到点未通过，后续提交已暂停。' : '服务端已确认保存。';
      await this.options.queue.update(row);
      try { this.current(row.scope); this.options.onResult(response.data); } catch (_) { /* Persisted confirmation is authoritative. */ }
    } catch (cause) {
      const error = cause as ApiError;
      row.phase = ['DATASET_EPOCH_CONFLICT', 'EPOCH_CHANGED'].includes(error.code) ? 'isolated' :
        [401, 403].includes(error.status ?? 0) ? 'blocked' : error.status === 409 ? 'conflict' :
          error.status && error.status >= 400 && error.status < 500 || error.code?.startsWith('PHOTO_') ? 'failed' : 'unknown';
      row.message = `${errorMessage(error as Error)}${row.sent ? ' 请用原请求核验，勿重复新建。' : ' 尚未提交业务。'}`;
      row.nextAttempt = Date.now() + Math.min(60000, 1000 * 2 ** row.attempts);
      await this.options.queue.update(row);
    }
  }
}

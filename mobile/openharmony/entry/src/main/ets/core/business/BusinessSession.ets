import { TaskAccess } from '../field/TaskCommander';
import { Identity } from '../../data/models/Identity';
import { ApiError, errorMessage } from '../network/ApiError';
import { scopeKey } from '../offline/OfflineModels';
import { authorizationOf } from '../identity/authorization';
import { BusinessWrite, BusinessResult, BusinessState, PendingBusiness, BusinessJournal } from './BusinessModels';
import { reportId } from '../report/ReportDraft';

export interface BusinessOptions {
  access: () => TaskAccess | null; onChange: (state: BusinessState) => void;
  onResult: (result: BusinessResult) => void; journal?: BusinessJournal;
}
function scope(access: TaskAccess): string {
  return scopeKey({ baseUrl: access.baseUrl, user: access.user, workspace: access.workspace });
}
export class BusinessSession {
  private options: BusinessOptions;
  private pending: PendingBusiness | null = null;
  private busy: boolean = false;
  private generation: number = 0;
  constructor(options: BusinessOptions) { this.options = options; }
  deactivate(): void { this.generation++; this.pending = null; this.busy = false; }
  private publish(phase: string, message: string): void {
    const state = new BusinessState(); state.phase = phase; state.message = message;
    state.operationId = this.pending?.key ?? ''; this.options.onChange(state);
  }
  async restore(): Promise<void> {
    const access = this.options.access(), generation = this.generation;
    if (!access || !this.options.journal) return;
    const saved = await this.options.journal.load(scope(access));
    if (generation !== this.generation || this.options.access()?.client !== access.client) return;
    if (saved && ['sending', 'unknown', 'prepared'].includes(saved.phase)) {
      this.pending = saved; this.publish('unknown', '有一笔办理尚待核验，请用原请求核验结果。');
    }
  }
  async submit(write: BusinessWrite): Promise<BusinessResult | undefined> {
    const access = this.options.access();
    if (!access || this.busy || this.pending) return undefined;
    if (!write.path.startsWith('/') || write.path.includes('..')) throw new Error('无效业务路径');
    this.pending = { write: { path: write.path, body: write.body, kind: write.kind, targetId: write.targetId },
      scope: scope(access), key: `business-${reportId()}`, sent: false, phase: 'prepared' };
    return this.send(access);
  }
  async retry(): Promise<BusinessResult | undefined> {
    const access = this.options.access();
    if (!access || !this.pending || this.busy || scope(access) !== this.pending.scope) return undefined;
    return this.send(access);
  }
  private current(access: TaskAccess, generation: number): boolean {
    const latest = this.options.access();
    return generation === this.generation && latest !== null && latest.client === access.client && scope(latest) === scope(access);
  }
  private async authorize(access: TaskAccess, generation: number): Promise<void> {
    const response = await access.client.send<Identity>('/auth/me');
    if (!this.current(access, generation) || authorizationOf(response.data) !== authorizationOf(access.user)) {
      throw new ApiError('AUTHORIZATION_CHANGED', '身份或授权已变化，原办理已暂停。', 403);
    }
  }
  private validate(result: BusinessResult, write: BusinessWrite): void {
    const row = write.kind === 'order' ? result.order : write.kind === 'issue' ? result.issue :
      write.kind === 'event' ? result.event : result.task ?? result.maintenance;
    const body = JSON.parse(write.body) as Record<string, string | number>;
    if (!row || !row.id || (write.targetId && row.id !== write.targetId) || !Number.isInteger(row.rev) ||
      typeof body['expectedRev'] === 'number' && row.rev <= Number(body['expectedRev']) ||
      write.kind === 'order' && body['to'] && row.status !== body['to']) {
      throw new ApiError('INVALID_RESPONSE', '返回内容不完整，请用原请求核验。');
    }
  }
  private async send(access: TaskAccess): Promise<BusinessResult | undefined> {
    const pending = this.pending!; this.busy = true; const generation = this.generation;
    this.publish('sending', '正在保存，请稍候…');
    try {
      await this.options.journal?.save(pending);
      await this.authorize(access, generation);
      pending.sent = true; pending.phase = 'sending'; await this.options.journal?.save(pending);
      if (!this.current(access, generation)) return undefined;
      const response = await access.client.send<BusinessResult>(`/datasets/demo-main${pending.write.path}`, {
        method: 'POST', body: pending.write.body, idempotencyKey: pending.key, datasetEpoch: access.workspace.epoch });
      await this.authorize(access, generation);
      if (response.meta?.datasetEpoch !== access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '演示数据已更新。', 409);
      this.validate(response.data, pending.write);
      pending.phase = 'done'; pending.result = response.data; await this.options.journal?.save(pending);
      if (!this.current(access, generation)) return undefined;
      this.pending = null; this.publish('done', '服务端已保存，关联进度正在更新。');
      try { this.options.onResult(response.data); } catch (_) { /* UI refresh cannot undo the persisted confirmation. */ }
      return response.data;
    } catch (cause) {
      if (!this.current(access, generation)) return undefined;
      const error = cause as ApiError;
      const phase = error.status === 409 ? 'conflict' : error.status && error.status >= 400 && error.status < 500 ? 'error' : pending.sent ? 'unknown' : 'error';
      pending.phase = pending.sent && [401, 403].includes(error.status ?? 0) ? 'unknown' : phase;
      try { await this.options.journal?.save(pending); } catch (_) { /* Keep the original request in memory. */ }
      if (phase !== 'unknown') this.pending = null;
      this.publish(phase, phase === 'unknown' ? '办理结果待核验，服务端可能已保存。请用原请求核验，勿重复新建。' : errorMessage(error as Error));
      return undefined;
    } finally { if (generation === this.generation) this.busy = false; }
  }
}

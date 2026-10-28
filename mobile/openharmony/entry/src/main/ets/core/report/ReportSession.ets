import { PreparedPhoto, ReportTarget, ReportResult, IssueRecord, MediaResult } from '../../data/models/Reports';
import { TaskAccess } from '../field/TaskCommander';
import { ApiError, errorMessage } from '../network/ApiError';
import { ReportDraft } from './ReportDraft';
import { ReportLease } from './ReportLease';

export class ReportView {
  draft: ReportDraft | null = null;
  phase: string = 'idle';
  message: string = '';
  issue: IssueRecord | null = null;
}

export interface ReportOptions {
  access: () => TaskAccess | null;
  onChange: (state: ReportView) => void;
  invalidate: (message: string) => void;
  disposePhoto: (photo: PreparedPhoto) => void;
  onResult?: (result: ReportResult) => void;
}

export class ReportSession {
  private options: ReportOptions;
  private view: ReportView = new ReportView();
  private lease: ReportLease | null = null;
  private external: boolean = false;
  private generation: number = 0;
  private pendingBody: string = '';
  private pendingKey: string = '';

  constructor(options: ReportOptions) { this.options = options; }
  isExternal(): boolean { return this.external; }
  private locked(): boolean { return ['picking', 'sending', 'unknown', 'done'].includes(this.view.phase); }
  private publish(): void {
    const copy = new ReportView();
    copy.draft = this.view.draft?.copy() ?? null; copy.phase = this.view.phase;
    copy.message = this.view.message; copy.issue = this.view.issue;
    this.options.onChange(copy);
  }
  private phase(phase: string, message: string): void { this.view.phase = phase; this.view.message = message; this.publish(); }

  deactivate(): void {
    this.generation++;
    this.view.draft?.photos.forEach((photo) => this.options.disposePhoto(photo.prepared));
    this.view = new ReportView(); this.lease = null; this.pendingBody = ''; this.pendingKey = '';
    this.publish();
  }

  start(target: ReportTarget): boolean {
    if (this.locked()) return false;
    const access = this.options.access();
    if (!access) return false;
    const task = access.workspace.tasks.find((row) => row.id === target.taskId);
    if (target.taskId && (!task || task.planSnapshot.executorRole !== access.user.role || !task.planSnapshot.pointIds.includes(target.pointId))) return false;
    this.deactivate(); this.lease = new ReportLease(access, this.options.access);
    this.view.draft = new ReportDraft(target); this.phase('editing', '记录你看到的变化，提交后进入服务端问题池。');
    return true;
  }

  field(key: string, value: string): void {
    if (this.locked() || !this.view.draft) return;
    if (key === 'anomalyType') this.view.draft.anomalyType = value.slice(0, 80);
    if (key === 'description') this.view.draft.description = value.slice(0, 4000);
    this.publish();
  }

  remove(id: string): void {
    if (this.locked() || !this.view.draft) return;
    const photo = this.view.draft.photos.find((row) => row.prepared.draftId === id);
    if (photo) this.options.disposePhoto(photo.prepared);
    this.view.draft.photos = this.view.draft.photos.filter((row) => row.prepared.draftId !== id); this.publish();
  }

  async choose(select: () => Promise<PreparedPhoto | null>): Promise<void> {
    if (this.locked() || !this.view.draft || !this.lease) return;
    const draft = this.view.draft, lease = this.lease, generation = this.generation;
    if (draft.photos.length >= 3) { this.phase('editing', '每次上报最多3张照片。'); return; }
    this.external = true; this.phase('picking', '正在选择照片，填写内容已保留。');
    let picked: PreparedPhoto | null = null;
    try {
      await lease.authorize(draft.target);
      if (generation !== this.generation) return;
      picked = await select();
      if (generation !== this.generation) return;
      await lease.authorize(draft.target);
      if (generation !== this.generation) return;
      if (picked) { draft.add(picked); picked = null; }
      this.phase('editing', '照片暂存在本机，随问题提交上传；取消选图不会清空文字。');
    } catch (cause) {
      if (generation === this.generation) {
        const error = cause instanceof ApiError ? cause : new ApiError('PHOTO_SELECTION_FAILED',
          `照片未添加：可能已取消或未获权限。${(cause as Error).message ?? ''}`);
        this.failed(error, 'editing');
      }
    } finally {
      if (picked) this.options.disposePhoto(picked);
      this.external = false;
    }
  }

  private failed(cause: ApiError, phase: string): void {
    if (['AUTHORIZATION_CHANGED', 'EPOCH_CHANGED'].includes(cause.code) || [401, 403].includes(cause.status ?? 0)) {
      this.deactivate(); this.options.invalidate(errorMessage(cause as Error)); return;
    }
    this.phase(phase, errorMessage(cause as Error));
  }

  private async upload(draft: ReportDraft, lease: ReportLease, generation: number): Promise<void> {
    for (const photo of draft.photos) {
      if (photo.mediaId) continue;
      await lease.authorize(draft.target);
      if (generation !== this.generation) throw new ApiError('CANCELLED', '上报已取消。');
      const data = photo.prepared;
      const query = `fileName=${encodeURIComponent(data.fileName)}${draft.target.pointId ? `&pointId=${encodeURIComponent(draft.target.pointId)}` : ''}`;
      const response = await lease.access.client.send<MediaResult>(`/datasets/demo-main/media?${query}`, {
        method: 'POST', body: data.bytes, contentType: data.mimeType, idempotencyKey: data.draftId, datasetEpoch: lease.access.workspace.epoch });
      await lease.authorize(draft.target);
      if (generation !== this.generation) throw new ApiError('CANCELLED', '上报已取消。');
      if (!response.data.id || response.data.size !== data.bytes.byteLength || !/^[a-f0-9]{64}$/.test(response.data.sha256)) {
        throw new ApiError('INVALID_RESPONSE', '照片响应不完整，请使用原照片重试。');
      }
      photo.mediaId = response.data.id; photo.sha256 = response.data.sha256; this.publish();
    }
  }

  async submit(): Promise<ReportResult | undefined> {
    if (this.locked() || !this.view.draft || !this.lease) return undefined;
    const draft = this.view.draft, lease = this.lease, generation = this.generation;
    if (!draft.anomalyType.trim() || !draft.description.trim()) { this.phase('editing', '请填写异常类型和现场描述。'); return undefined; }
    this.phase('sending', '正在上传照片并提交，请勿重复操作。');
    try {
      await this.upload(draft, lease, generation);
      if (draft.validate()) throw new Error(draft.validate());
    } catch (cause) {
      if (generation === this.generation) this.failed(cause as ApiError, 'upload-error');
      return undefined;
    }
    if (generation !== this.generation) return undefined;
    this.pendingBody = draft.body(); this.pendingKey = `${draft.submissionId}-commit-${draft.target.expectedRev}`;
    return this.commit(draft, lease, generation);
  }

  async retry(): Promise<ReportResult | undefined> {
    if (this.view.phase !== 'unknown' || !this.view.draft || !this.lease) return undefined;
    this.phase('sending', '使用原标识核验提交结果…');
    return this.commit(this.view.draft, this.lease, this.generation);
  }

  private async commit(draft: ReportDraft, lease: ReportLease, generation: number): Promise<ReportResult | undefined> {
    let sent = false;
    try {
      await lease.authorize(draft.target);
      if (generation !== this.generation) return undefined;
      const path = draft.target.taskId ? `/inspection/tasks/${encodeURIComponent(draft.target.taskId)}/issues` : '/issues';
      sent = true;
      const response = await lease.access.client.send<ReportResult>(`/datasets/demo-main${path}`, {
        method: 'POST', body: this.pendingBody, idempotencyKey: this.pendingKey, datasetEpoch: lease.access.workspace.epoch });
      await lease.authorize(draft.target);
      if (generation !== this.generation) return undefined;
      if (response.meta?.datasetEpoch !== lease.access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '演示数据已变化。');
      if (!response.data.issue?.id || response.data.issue.pointId !== (draft.target.pointId || null)) {
        throw new ApiError('INVALID_RESPONSE', '上报响应不完整，请用原请求核验。');
      }
      this.view.issue = response.data.issue;
      this.options.onResult?.(response.data);
      this.phase('done', `已提交 ${response.data.issue.issueNo}，等待审核；问题尚未关闭。`);
      return response.data;
    } catch (cause) {
      if (generation !== this.generation) return undefined;
      const error = cause as ApiError;
      this.failed(error, error.status === 409 ? 'conflict' : error.status && error.status >= 400 && error.status < 500 ? 'editing' : sent ? 'unknown' : 'editing');
      return undefined;
    }
  }

  adoptRevision(rev: number): void {
    if (this.view.phase !== 'conflict' || !this.view.draft || !Number.isInteger(rev)) return;
    this.view.draft.target.expectedRev = rev; this.pendingBody = ''; this.pendingKey = '';
    this.phase('editing', '已明确采用新版本，照片与描述保留。请核对后提交。');
  }
}

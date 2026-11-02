import { PreparedPhoto, ReportTarget, ReportResult, IssueRecord, MediaResult, HandlingRequest } from '../../data/models/Reports';
import { WorkOrder } from '../../data/models/Tasks';
import { TaskAccess } from '../field/TaskCommander';
import { ApiError, errorMessage } from '../network/ApiError';
import { ReportDraft } from './ReportDraft';
import { ReportLease } from './ReportLease';
import { ReportView, DraftPreview } from './ReportView';
import { initialTarget, prepareHandling } from './Handling';

class ReportState {
  draft: ReportDraft | null = null;
  phase: string = 'idle';
  message: string = '';
  issue: IssueRecord | null = null;
  order: WorkOrder | null = null;
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
  private view: ReportState = new ReportState();
  private lease: ReportLease | null = null;
  private external: boolean = false;
  private generation: number = 0;
  private pendingBody: string = '';
  private pendingKey: string = '';

  constructor(options: ReportOptions) { this.options = options; }
  isExternal(): boolean { return this.external; }
  private locked(): boolean { return ['loading', 'picking', 'sending', 'unknown', 'done'].includes(this.view.phase); }
  private publish(): void {
    const copy = new ReportView();
    copy.draft = this.view.draft ? new DraftPreview(this.view.draft) : null; copy.phase = this.view.phase;
    copy.message = this.view.message; copy.issue = this.view.issue;
    copy.order = this.view.order;
    this.options.onChange(copy);
  }
  private phase(phase: string, message: string): void { this.view.phase = phase; this.view.message = message; this.publish(); }

  deactivate(): void {
    this.generation++;
    this.view.draft?.photos.forEach((photo) => this.options.disposePhoto(photo.prepared));
    this.view = new ReportState(); this.lease = null; this.pendingBody = ''; this.pendingKey = '';
    this.publish();
  }

  start(target: ReportTarget): boolean {
    if (this.view.draft && this.view.phase !== 'done') {
      const previous = this.view.draft.target;
      return !this.locked() && previous.pointId === target.pointId && previous.buildingId === target.buildingId && previous.taskId === target.taskId;
    }
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
    if (key === 'note') this.view.draft.note = value.slice(0, 4000);
    if (key === 'measures') this.view.draft.measures = value.slice(0, 4000);
    if (key === 'materials') this.view.draft.materials = value.slice(0, 2000);
    this.publish();
  }

  async startHandling(request: HandlingRequest): Promise<boolean> {
    if (this.view.draft && this.view.phase !== 'done') return false;
    if (this.locked() && this.view.phase !== 'done') return false;
    const access = this.options.access();
    if (!access) return false;
    this.deactivate(); const generation = this.generation;
    this.phase('loading', '正在读取当前办理条件…');
    try {
      const target = initialTarget(access, request); const lease = new ReportLease(access, this.options.access);
      const draft = await prepareHandling(lease, target);
      if (generation !== this.generation || !lease.current()) return false;
      this.view.draft = draft; this.lease = lease;
      this.phase('editing', target.issueId ? '补充材料将追加到原问题，原始描述与照片保留。' :
        target.action === 'submitted' ? '填写维修措施后提交待验收。' : target.requireNote ? '物业代接请说明原因。' : '核对后即可接单。');
      return true;
    } catch (cause) {
      if (generation === this.generation) this.failed(cause as ApiError, 'editing');
      return false;
    }
  }

  photoKind(id: string, kind: string): void {
    if (this.locked() || !this.view.draft?.target.orderId || !['before', 'after'].includes(kind)) return;
    const photo = this.view.draft.photos.find((row) => row.prepared.draftId === id);
    if (photo) { photo.kind = kind; this.publish(); }
  }

  remove(id: string): void {
    if (this.locked() || !this.view.draft) return;
    const photo = this.view.draft.photos.find((row) => row.prepared.draftId === id);
    if (photo) this.options.disposePhoto(photo.prepared);
    this.view.draft.photos = this.view.draft.photos.filter((row) => row.prepared.draftId !== id); this.publish();
  }

  /** 把 AI 结论作为建议填入当前草稿；只填文字，不提交、不覆盖已有说明。 */
  applySuggestion(text: string): boolean {
    if (this.locked() || !this.view.draft) return false;
    const clean = text.trim().slice(0, 4000);
    if (!clean) return false;
    if (this.view.draft.target.orderId && this.view.draft.target.action === 'submitted') {
      this.view.draft.measures = this.view.draft.measures.trim()
        ? `${this.view.draft.measures.trim()}
${clean}` : clean;
    } else if (this.view.draft.target.issueId || this.view.draft.target.orderId) {
      this.view.draft.note = this.view.draft.note.trim()
        ? `${this.view.draft.note.trim()}
${clean}` : clean;
    } else if (!this.view.draft.description.trim()) {
      this.view.draft.description = clean;
    } else {
      this.view.draft.note = this.view.draft.note.trim()
        ? `${this.view.draft.note.trim()}
${clean}` : clean;
    }
    this.publish();
    return true;
  }

  async choose(select: () => Promise<PreparedPhoto | null>): Promise<void> {
    if (this.locked() || !this.view.draft || !this.lease) return;
    const draft = this.view.draft, lease = this.lease, generation = this.generation;
    if (draft.photos.length + (draft.target.existingPhotoCount ?? 0) >= 3) { this.phase('editing', '同一业务最多3张照片，已有照片也占配额。'); return; }
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
    if (['CANCELLED', 'AUTHORIZATION_CHANGED', 'EPOCH_CHANGED', 'DATASET_EPOCH_CONFLICT'].includes(cause.code) || [401, 403].includes(cause.status ?? 0)) {
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
    const validation = draft.validateText();
    if (validation) { this.phase('editing', validation); return undefined; }
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
      const path = draft.target.issueId ? `/issues/${encodeURIComponent(draft.target.issueId)}/supplements` :
        draft.target.orderId ? `/work-orders/${encodeURIComponent(draft.target.orderId)}/actions` :
          draft.target.taskId ? `/inspection/tasks/${encodeURIComponent(draft.target.taskId)}/issues` : '/issues';
      sent = true;
      const response = await lease.access.client.send<ReportResult>(`/datasets/demo-main${path}`, {
        method: 'POST', body: this.pendingBody, idempotencyKey: this.pendingKey, datasetEpoch: lease.access.workspace.epoch });
      await lease.authorize(draft.target);
      if (generation !== this.generation) return undefined;
      if (response.meta?.datasetEpoch !== lease.access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '演示数据已变化。');
      const result = response.data;
      const valid = draft.target.orderId ? result.order?.id === draft.target.orderId &&
        Number.isInteger(result.order.rev) && result.order.rev > draft.target.expectedRev &&
        result.order.status === draft.target.action && !!result.order.orderNo && Array.isArray(result.order.photos) :
        !!result.issue?.id && result.issue.pointId === (draft.target.pointId || null) && (!draft.target.issueId || result.issue.id === draft.target.issueId);
      if (!valid) {
        throw new ApiError('INVALID_RESPONSE', '上报响应不完整，请用原请求核验。');
      }
      this.view.issue = result.issue ?? null; this.view.order = result.order ?? null;
      this.options.onResult?.(result);
      this.phase('done', result.order ? `工单 ${result.order.orderNo} 已由服务端保存；完工提交不等于验收通过。` :
        `已提交 ${result.issue?.issueNo ?? ''}，等待审核；问题尚未关闭。`);
      return result;
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

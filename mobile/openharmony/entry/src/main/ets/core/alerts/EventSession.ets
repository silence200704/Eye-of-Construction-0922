import { AlarmEvent } from '../../data/models/Monitoring';
import { TaskAccess } from '../field/TaskCommander';
import { ReportLease } from '../report/ReportLease';
import { ReportTarget } from '../../data/models/Reports';
import { ApiError, errorMessage } from '../network/ApiError';

export interface EventWrite { eventId: string; action: string; kind?: string; note?: string; basis?: string; noRepairNote?: string; }
export class EventView { eventId: string = ''; phase: string = 'idle'; message: string = ''; }
export interface EventOptions {
  access: () => TaskAccess | null;
  onChange: (view: EventView) => void;
  onEvent: (event: AlarmEvent) => void;
  invalidate: (message: string) => void;
}
interface EventPending { eventId: string; action: string; body: string; key: string; target: ReportTarget; lease: ReportLease; }

export class EventSession {
  private options: EventOptions;
  private pending: EventPending | null = null;
  private view: EventView = new EventView();
  private generation: number = 0;
  constructor(options: EventOptions) { this.options = options; }
  deactivate(): void { this.generation++; this.pending = null; this.view = new EventView(); this.publish(); }
  private publish(): void {
    const copy = new EventView(); copy.eventId = this.view.eventId; copy.phase = this.view.phase; copy.message = this.view.message;
    this.options.onChange(copy);
  }
  private phase(phase: string, message: string): void { this.view.phase = phase; this.view.message = message; this.publish(); }

  private validate(write: EventWrite, access: TaskAccess): AlarmEvent {
    const event = access.workspace.events.find((row) => row.id === write.eventId);
    if (!event || event.status === 'closed') throw new ApiError('STATE_CONFLICT', '事件已关闭或不可用，请刷新。', 409);
    const field = write.action === 'field-notes';
    if (!(field ? ['safety', 'property'] : ['safety']).includes(access.user.role)) throw new ApiError('ROLE_FORBIDDEN', '当前身份只能查看此动作。', 403);
    if (!['acknowledge', 'field-notes', 'close'].includes(write.action)) throw new ApiError('INVALID_COMMAND', '动作不可用。');
    if (write.action === 'acknowledge' && event.status !== 'pending') throw new ApiError('STATE_CONFLICT', '事件当前无需再次确认。', 409);
    if (field && ((write.note?.trim().length ?? 0) < 10 || !['investigation', 'measures'].includes(write.kind ?? ''))) {
      throw new ApiError('VALIDATION_FAILED', '排查或措施说明至少10字。');
    }
    if (write.action === 'close' && (event.status !== 'recovering' || !write.basis?.trim())) {
      throw new ApiError('STATE_CONFLICT', '只有恢复待确认事件可以填写复查依据关闭。', 409);
    }
    return event;
  }

  async submit(write: EventWrite): Promise<void> {
    if (['sending', 'unknown'].includes(this.view.phase)) return;
    const access = this.options.access(); if (!access) return;
    this.view.eventId = write.eventId;
    try {
      const event = this.validate(write, access);
      const point = access.workspace.points.find((row) => row.id === event.pointId);
      if (!point) throw new ApiError('NOT_FOUND', '当前测点不可查看。', 404);
      const body: Record<string, string | number> = { expectedRev: event.rev };
      if (write.action === 'field-notes') { body.kind = write.kind ?? ''; body.note = write.note?.trim() ?? ''; }
      if (write.action === 'close') { body.basis = write.basis?.trim() ?? ''; body.noRepairNote = write.noRepairNote?.trim() ?? ''; }
      this.pending = { eventId: event.id, action: write.action, body: JSON.stringify(body),
        key: `alarm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        target: { pointId: point.id, buildingId: point.buildingId, floorId: point.floorId, taskId: '', expectedRev: event.rev },
        lease: new ReportLease(access, this.options.access) };
      await this.send();
    } catch (cause) { this.phase('error', errorMessage(cause as Error)); }
  }

  async retry(): Promise<void> { if (this.view.phase === 'unknown') await this.send(); }

  private async send(): Promise<void> {
    const pending = this.pending; if (!pending) return;
    const generation = this.generation; let sent = false;
    this.phase('sending', '正在保存当前办理，请稍候…');
    try {
      await pending.lease.authorize(pending.target);
      if (generation !== this.generation) return;
      sent = true;
      const response = await pending.lease.access.client.send<AlarmEvent>(`/datasets/demo-main/events/${encodeURIComponent(pending.eventId)}/${pending.action}`, {
        method: 'POST', body: pending.body, idempotencyKey: pending.key, datasetEpoch: pending.lease.access.workspace.epoch });
      await pending.lease.authorize(pending.target);
      if (generation !== this.generation) return;
      if (response.meta?.datasetEpoch !== pending.lease.access.workspace.epoch) throw new ApiError('EPOCH_CHANGED', '数据已复位。');
      const event = response.data;
      if (event.id !== pending.eventId || !Number.isInteger(event.rev) || event.rev <= pending.target.expectedRev || !Array.isArray(event.timeline)) {
        throw new ApiError('INVALID_RESPONSE', '办理响应不完整，请用原请求核验。');
      }
      this.options.onEvent(event); this.pending = null; this.phase('done', '服务端已保存本次办理。');
    } catch (cause) {
      if (generation !== this.generation) return;
      const error = cause as ApiError;
      if (['CANCELLED', 'AUTHORIZATION_CHANGED', 'EPOCH_CHANGED', 'DATASET_EPOCH_CONFLICT'].includes(error.code) || [401, 403].includes(error.status ?? 0)) {
        this.deactivate(); this.options.invalidate(errorMessage(error as Error)); return;
      }
      if (error.status && error.status >= 400 && error.status < 500) this.pending = null;
      this.phase(error.status === 409 ? 'conflict' : this.pending && sent ? 'unknown' : 'error', errorMessage(error as Error));
    }
  }
}

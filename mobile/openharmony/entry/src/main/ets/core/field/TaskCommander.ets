import { Identity } from '../../data/models/Identity';
import { ApiClient } from '../../data/models/Http';
import { Workspace } from '../../data/models/Workspace';
import { InspectionTask } from '../../data/models/Tasks';
import { TaskWrite, TaskCommandState, TaskCommandResult } from '../../data/models/Inspection';
import { ApiError, errorMessage } from '../network/ApiError';
import { authorizationOf } from '../identity/authorization';
import { BusinessJournal, PendingBusiness } from '../business/BusinessModels';
import { selectedDataset } from '../network/DatasetSelection';

export interface TaskAccess {
  client: ApiClient;
  user: Identity;
  baseUrl: string;
  workspace: Workspace;
}

export interface CommanderOptions {
  access: () => TaskAccess | null;
  onState: (state: TaskCommandState) => void;
  onTask: (task: InspectionTask) => InspectionTask;
  invalidate: (message: string) => void;
  journal?: BusinessJournal;
}

interface PendingCommand {
  write: TaskWrite;
  stamp: string;
  key: string;
  sent: boolean;
}

function stamp(access: TaskAccess): string {
  return `${access.baseUrl}|${selectedDataset()}|${access.workspace.epoch}|${authorizationOf(access.user)}`;
}

export class TaskCommander {
  private options: CommanderOptions;
  private pending: Map<string, PendingCommand> = new Map();
  private generation: number = 0;
  private busy: boolean = false;
  private counter: number = 0;

  constructor(options: CommanderOptions) { this.options = options; }
  setJournal(journal: BusinessJournal): void { this.options.journal = journal; }

  deactivate(): void { this.generation++; this.busy = false; }

  private state(phase: string, message: string, pending?: PendingCommand): void {
    const state = new TaskCommandState();
    state.phase = phase;
    state.message = message;
    state.taskId = pending?.write.taskId ?? '';
    state.pointId = pending?.write.pointId ?? '';
    state.operationId = pending?.key ?? '';
    this.options.onState(state);
  }

  async restore(): Promise<void> {
    const access = this.options.access();
    if (access && this.options.journal && !this.pending.has(stamp(access))) {
      const saved = await this.options.journal.load(stamp(access));
      if (this.options.access()?.client !== access.client) return;
      if (saved && saved.write.kind === 'task') {
        const payload = JSON.parse(saved.write.body) as Record<string, string | number>;
        this.pending.set(saved.scope, { stamp: saved.scope, key: saved.key, sent: saved.sent,
          write: { taskId: saved.write.targetId, pointId: String(payload['pointId']),
            action: saved.write.path.split('/').pop() ?? '', body: saved.write.body } });
      }
    }
    const pending = access ? this.pending.get(stamp(access)) : undefined;
    if (pending) this.state('unknown', '有一次提交尚待服务端核验，请使用原请求重试。', pending);
  }
  private persist(pending: PendingCommand, phase: string): Promise<void> {
    const saved: PendingBusiness = { scope: pending.stamp, key: pending.key, sent: pending.sent, phase,
      write: { path: `/inspection/tasks/${encodeURIComponent(pending.write.taskId)}/${pending.write.action}`,
        kind: 'task', targetId: pending.write.taskId, body: pending.write.body } };
    return this.options.journal?.save(saved) ?? Promise.resolve();
  }

  private validate(write: TaskWrite, access: TaskAccess): void {
    const task = access.workspace.tasks.find((row) => row.id === write.taskId);
    if (!task || task.planSnapshot.executorRole !== access.user.role) {
      throw new ApiError('ROLE_FORBIDDEN', '当前身份不是此任务的执行角色。');
    }
    if (!['check-in', 'complete-point'].includes(write.action) || !task.planSnapshot.pointIds.includes(write.pointId)) {
      throw new ApiError('INVALID_COMMAND', '任务动作或测点不属于当前任务。');
    }
    const payload = JSON.parse(write.body) as Record<string, string | number>;
    if (payload.pointId !== write.pointId || payload.expectedRev !== task.rev) {
      throw new ApiError('REVISION_CONFLICT', '任务版本已变化，请刷新核对后再提交。', 409);
    }
    const point = access.workspace.points.find((row) => row.id === write.pointId && row.status === 'active');
    if (!point || point.buildingId !== task.buildingId) throw new ApiError('NOT_FOUND', '任务测点已不可用。', 404);
  }

  async submit(write: TaskWrite): Promise<TaskCommandResult | undefined> {
    if (this.busy) return undefined;
    const access = this.options.access();
    if (!access) return undefined;
    if (this.pending.has(stamp(access))) {
      this.restore();
      return undefined;
    }
    try {
      this.validate(write, access);
    } catch (cause) {
      const error = cause as ApiError;
      this.state(error.status === 409 ? 'conflict' : 'error', errorMessage(error as Error));
      return undefined;
    }
    const pending: PendingCommand = { write: { taskId: write.taskId, pointId: write.pointId, action: write.action, body: write.body }, stamp: stamp(access), sent: false,
      key: `native-${Date.now()}-${++this.counter}-${Math.random().toString(36).slice(2)}` };
    this.pending.set(pending.stamp, pending);
    return this.send(pending, access);
  }

  async retry(): Promise<TaskCommandResult | undefined> {
    const access = this.options.access();
    if (this.busy || !access) return undefined;
    const pending = this.pending.get(stamp(access));
    return pending ? this.send(pending, access) : undefined;
  }

  private current(access: TaskAccess, generation: number): boolean {
    const latest = this.options.access();
    return generation === this.generation && latest !== null && latest.client === access.client && stamp(latest) === stamp(access);
  }

  private async authorize(access: TaskAccess, generation: number): Promise<void> {
    const response = await access.client.send<Identity>('/auth/me');
    if (!this.current(access, generation)) throw new ApiError('CANCELLED', '请求已失效');
    if (authorizationOf(response.data) !== authorizationOf(access.user)) {
      throw new ApiError('AUTHORIZATION_CHANGED', '身份授权已变化，请重新读取当前范围。');
    }
  }

  private async send(pending: PendingCommand, access: TaskAccess): Promise<TaskCommandResult | undefined> {
    this.busy = true;
    const generation = ++this.generation;
    this.state('sending', '正在提交，请稍候…', pending);
    try {
      await this.persist(pending, 'prepared');
      await this.authorize(access, generation);
      pending.sent = true;
      await this.persist(pending, 'sending');
      if (!this.current(access, generation)) return undefined;
      const response = await access.client.send<TaskCommandResult>(
        `/datasets/demo-main/inspection/tasks/${encodeURIComponent(pending.write.taskId)}/${pending.write.action}`,
        { method: 'POST', body: pending.write.body, idempotencyKey: pending.key, datasetEpoch: access.workspace.epoch });
      if (!this.current(access, generation)) return undefined;
      if (response.meta?.datasetEpoch !== access.workspace.epoch) {
        throw new ApiError('EPOCH_CHANGED', '演示数据已更新，请重新读取。');
      }
      await this.authorize(access, generation);
      const result = response.data;
      if (!result.task || result.task.id !== pending.write.taskId || !Number.isInteger(result.task.rev)) {
        throw new ApiError('INVALID_RESPONSE', '提交响应不完整，请用原请求核验。');
      }
      await this.persist(pending, 'done');
      if (!this.current(access, generation)) return undefined;
      result.task = this.options.onTask(result.task);
      this.pending.delete(pending.stamp);
      this.state(result.attempt?.passed === false ? 'rejected' : 'done', result.attempt?.message ?? '服务端已保存检查结果。', pending);
      return result;
    } catch (cause) {
      const error = cause as ApiError;
      try { await this.persist(pending, pending.sent && (!error.status || [401, 403].includes(error.status)) ? 'unknown' : 'error'); }
      catch (_) { /* Earlier frozen request remains available for recovery. */ }
      this.failed(pending, access, generation, cause as ApiError);
      return undefined;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  private failed(pending: PendingCommand, access: TaskAccess, generation: number, cause: ApiError): void {
    if (!this.current(access, generation)) return;
    if (['AUTHORIZATION_CHANGED', 'EPOCH_CHANGED'].includes(cause.code) || cause.status === 401 || cause.status === 403) {
      this.options.invalidate(errorMessage(cause as Error));
      return;
    }
    if (cause.status && cause.status >= 400 && cause.status < 500) {
      this.pending.delete(pending.stamp);
      this.state(cause.status === 409 ? 'conflict' : 'error', errorMessage(cause as Error), pending);
    } else {
      if (!pending.sent) this.pending.delete(pending.stamp);
      this.state(pending.sent ? 'unknown' : 'error', errorMessage(cause as Error), pending);
    }
  }
}

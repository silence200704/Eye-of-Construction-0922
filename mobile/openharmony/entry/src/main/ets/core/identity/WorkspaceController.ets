import { Identity, IdentitySession } from '../../data/models/Identity';
import { ApiClient, ClientSettings } from '../../data/models/Http';
import { readWorkspace } from '../../data/repositories/WorkspaceRepository';
import { emptyWorkspace, withTasks, withIssues } from '../../data/models/Workspace';
import { ReportResult } from '../../data/models/Reports';
import { InspectionTask } from '../../data/models/Tasks';
import { TaskWrite, TaskCommandResult } from '../../data/models/Inspection';
import { TaskCommander, TaskAccess } from '../field/TaskCommander';
import { AppState } from '../../shared/state/AppState';
import { SettingsStorage } from '../storage/ConnectionPreferences';
import { ApiError, errorMessage } from '../network/ApiError';
import { normalizeEndpoint } from '../network/Endpoint';
import { SessionGate } from './SessionGate';
import { authorizationOf } from './authorization';

const ROLES: string[] = ['safety', 'property', 'device', 'inspector', 'repair'];

export interface ControllerOptions {
  storage: SettingsStorage;
  createClient: (settings: ClientSettings) => ApiClient;
  onChange: (state: AppState) => void;
  onReset: () => void;
}

export class WorkspaceController {
  private options: ControllerOptions;
  private state: AppState = new AppState();
  private gate: SessionGate = new SessionGate();
  private client: ApiClient | null = null;
  private token: string = '';
  private preferredId: string = '';
  private suspended: boolean = false;
  private commands: TaskCommander;

  constructor(options: ControllerOptions) {
    this.options = options;
    this.commands = new TaskCommander({ access: () => this.taskAccess(),
      onState: (state) => { this.state.command = state; this.publish(); },
      onTask: (task) => this.applyTask(task), invalidate: (message) => this.invalidateInspection(message) });
  }

  private taskAccess(): TaskAccess | null {
    if (this.state.mode !== 'ready' || !this.state.user || !this.client) return null;
    return { client: this.client, user: this.state.user, baseUrl: this.state.baseUrl, workspace: this.state.workspace };
  }

  private applyTask(task: InspectionTask): InspectionTask {
    const previous = this.state.workspace.tasks.find((row) => row.id === task.id);
    if (!previous || previous.rev > task.rev) return previous ?? task;
    this.state.workspace = withTasks(this.state.workspace,
      this.state.workspace.tasks.map((row) => row.id === task.id ? task : row));
    this.state.loadedAt = new Date().toISOString();
    this.publish();
    return task;
  }

  private invalidateInspection(message: string): void {
    this.commands.deactivate();
    this.fail(this.gate.begin(), new ApiError('AUTHORIZATION_CHANGED', message) as Error);
    this.options.onReset();
  }

  async submitInspection(write: TaskWrite): Promise<TaskCommandResult | undefined> { return this.commands.submit(write); }

  async retryInspection(): Promise<TaskCommandResult | undefined> { return this.commands.retry(); }

  fieldAccess(): TaskAccess | null { return this.taskAccess(); }
  invalidateReport(message: string): void { this.invalidateInspection(message); }
  acceptReport(result: ReportResult): void {
    if (this.state.mode !== 'ready') return;
    if (result.task) this.applyTask(result.task);
    const previous = this.state.workspace.issues.find((row) => row.id === result.issue.id);
    if (previous && previous.rev > result.issue.rev) return;
    this.state.workspace = withIssues(this.state.workspace,
      [...this.state.workspace.issues.filter((row) => row.id !== result.issue.id), result.issue]);
    this.publish();
  }

  async reloadInspection(): Promise<void> {
    const access = this.taskAccess();
    if (!access) return;
    try {
      const principal = await access.client.send<Identity>('/auth/me');
      if (this.client !== access.client) return;
      if (authorizationOf(principal.data) !== authorizationOf(access.user)) {
        this.invalidateInspection('身份授权已变化，请重新读取。');
        return;
      }
      const response = await access.client.send<InspectionTask[]>('/datasets/demo-main/inspection/tasks');
      if (this.client !== access.client) return;
      if (response.meta?.datasetEpoch !== access.workspace.epoch || !Array.isArray(response.data)) {
        this.invalidateInspection('演示数据已更新，请重新读取。');
        return;
      }
      const confirmed = await access.client.send<Identity>('/auth/me');
      if (this.client !== access.client) return;
      if (authorizationOf(confirmed.data) !== authorizationOf(access.user)) {
        this.invalidateInspection('身份授权已变化，请重新读取。');
        return;
      }
      this.state.workspace = withTasks(this.state.workspace, response.data);
      this.publish();
    } catch (cause) { this.invalidateInspection(errorMessage(cause as Error)); }
  }

  private publish(): void {
    this.options.onChange(new AppState(this.state));
  }

  private begin(baseUrl: string): number {
    this.commands.deactivate();
    const revision = this.gate.begin();
    const directory = this.state.baseUrl === baseUrl ? this.state.identities : [];
    this.client?.cancel();
    this.client = null;
    this.token = '';
    this.state = new AppState();
    this.state.baseUrl = baseUrl;
    this.state.identities = directory;
    this.state.mode = 'loading';
    this.state.busy = true;
    this.options.onReset();
    this.publish();
    return revision;
  }

  private fail(revision: number, cause: Error): void {
    if (!this.gate.current(revision)) return;
    this.client?.cancel();
    this.client = null;
    this.token = '';
    this.state.user = null;
    this.state.workspace = emptyWorkspace();
    this.state.mode = 'error';
    this.state.busy = false;
    this.state.message = errorMessage(cause);
    this.publish();
  }

  async initialize(): Promise<void> {
    const revision = this.gate.begin();
    try {
      const saved = await this.options.storage.load();
      if (!this.gate.current(revision)) return;
      this.preferredId = saved.identityId;
      this.state.baseUrl = saved.baseUrl;
      this.publish();
      if (saved.baseUrl) await this.connect(saved.baseUrl, saved.identityId);
    } catch (_) {
      if (!this.gate.current(revision)) return;
      this.state.message = '无法读取连接设置，请重新设置服务地址。';
      this.publish();
    }
  }

  async connect(input: string, identityId: string = this.preferredId): Promise<void> {
    let base: string;
    try {
      base = normalizeEndpoint(input);
    } catch (cause) {
      this.fail(this.begin(this.state.baseUrl), cause as Error);
      return;
    }
    const revision = this.begin(base);
    const anonymous = this.options.createClient({ baseUrl: base, token: '' });
    this.client = anonymous;
    try {
      const response = await anonymous.send<Identity[]>('/demo/identities');
      if (!this.gate.current(revision)) return;
      const identities = response.data.filter((row: Identity) => ROLES.includes(row.role));
      const selected = identities.find((row: Identity) => row.id === identityId) ??
        identities.find((row: Identity) => row.role === 'safety') ?? identities[0];
      if (!selected) throw new ApiError('NO_IDENTITY', '当前服务没有可用的演示身份。');
      const session = await anonymous.send<IdentitySession>('/demo/identity', {
        method: 'POST', body: JSON.stringify({ identityId: selected.id })
      });
      if (!this.gate.current(revision)) return;
      this.token = session.data.accessToken;
      anonymous.cancel();
      this.client = this.options.createClient({ baseUrl: base, token: this.token });
      this.state.identities = identities;
      await this.loadAuthorized(revision, selected.id);
    } catch (cause) {
      this.fail(revision, cause as Error);
    }
  }

  private async loadAuthorized(revision: number, expectedId: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    const principal = await client.send<Identity>('/auth/me');
    if (!this.gate.current(revision)) return;
    if (principal.data.id !== expectedId || !ROLES.includes(principal.data.role)) {
      throw new ApiError('INVALID_IDENTITY', '身份信息已变化，请重新选择身份。');
    }
    const workspace = await readWorkspace({ client, isCurrent: () => this.gate.current(revision) });
    if (!this.gate.current(revision)) return;
    const latest = await client.send<Identity>('/auth/me');
    if (!this.gate.current(revision)) return;
    if (authorizationOf(latest.data) !== authorizationOf(principal.data)) {
      throw new ApiError('AUTHORIZATION_CHANGED', '授权范围已变化，请重新读取数据。');
    }
    await this.options.storage.save({ baseUrl: this.state.baseUrl, identityId: latest.data.id });
    if (!this.gate.current(revision)) return;
    this.preferredId = principal.data.id;
    this.state.user = latest.data;
    this.state.workspace = workspace;
    this.state.loadedAt = new Date().toISOString();
    this.state.mode = 'ready';
    this.state.busy = false;
    this.state.message = '';
    this.commands.restore();
    this.publish();
  }

  async select(identityId: string): Promise<void> {
    if (!this.state.identities.some((row: Identity) => row.id === identityId)) return;
    await this.connect(this.state.baseUrl, identityId);
  }

  async refresh(): Promise<void> {
    if (!this.state.baseUrl) return;
    const base = this.state.baseUrl;
    const token = this.token;
    const expectedId = this.state.user?.id ?? this.preferredId;
    const identities = this.state.identities;
    if (!token) {
      await this.connect(base, expectedId);
      return;
    }
    const revision = this.begin(base);
    this.token = token;
    this.state.identities = identities;
    this.client = this.options.createClient({ baseUrl: base, token });
    try {
      await this.loadAuthorized(revision, expectedId);
    } catch (cause) {
      if (this.gate.current(revision) && cause instanceof ApiError && cause.status === 401) {
        await this.connect(base, expectedId);
      } else {
        this.fail(revision, cause as Error);
      }
    }
  }

  suspend(): void {
    this.suspended = true;
    this.begin(this.state.baseUrl);
    this.state.mode = 'idle';
    this.state.busy = false;
    this.publish();
  }

  async resume(): Promise<void> {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.state.baseUrl) await this.connect(this.state.baseUrl, this.preferredId);
  }
}

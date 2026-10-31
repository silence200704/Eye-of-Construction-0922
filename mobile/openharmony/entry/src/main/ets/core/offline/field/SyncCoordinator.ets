import { OfflineVault } from '../OfflineVault';
import { TaskAccess } from '../../field/TaskCommander';
import { DurableReader } from '../queue/QueueModels';
import { BusinessResult } from '../../business/BusinessModels';
import { FieldQueue } from './FieldQueue';
import { FieldExecutor } from './FieldExecutor';
import { OutboxStore } from '../queue/OutboxStore';
import { OutboxExecutor } from '../queue/OutboxExecutor';
import { scopeKey } from '../OfflineModels';
export interface SyncOptions {
  vault: OfflineVault; access: () => TaskAccess | null; files: DurableReader;
  onResult: (result: BusinessResult) => void;
}
interface ResumeState { previous: string; paused: string[]; }
export class SyncCoordinator {
  field: FieldExecutor;
  private options: SyncOptions;
  private queue: OutboxStore;
  private outbox: OutboxExecutor;
  private previous: string = '';
  private paused: Set<string> = new Set();
  private busy: boolean = false;
  private initialized: boolean = false;
  constructor(options: SyncOptions) {
    this.options = options;
    this.field = new FieldExecutor({ queue: new FieldQueue(options.vault), access: options.access, files: options.files, onResult: options.onResult });
    this.queue = new OutboxStore(options.vault);
    this.outbox = new OutboxExecutor({ store: this.queue, files: options.files, access: options.access, onResult: options.onResult });
  }
  private async load(): Promise<void> {
    if (this.initialized) return;
    const values = await this.options.vault.query((db) => db.read('SELECT body FROM business_forms WHERE scope=? AND target=?', ['sync-control', 'resume']));
    if (values.length) { const saved = JSON.parse(values[0]) as ResumeState; this.previous = saved.previous; this.paused = new Set(saved.paused); }
    this.initialized = true;
  }
  private save(): Promise<void> {
    const saved: ResumeState = { previous: this.previous, paused: Array.from(this.paused) };
    const body = JSON.stringify(saved);
    return this.options.vault.query((db) => db.execute('INSERT OR REPLACE INTO business_forms (scope,target,body) VALUES (?,?,?)', ['sync-control', 'resume', body]));
  }
  async approve(scope: string): Promise<void> { await this.load(); this.paused.delete(scope); await this.save(); }
  async run(): Promise<void> {
    const access = this.options.access(); if (!access || this.busy) return;
    this.busy = true;
    try {
      await this.load();
      const scope = scopeKey({ baseUrl: access.baseUrl, user: access.user, workspace: access.workspace });
      if (this.previous && this.previous !== scope) this.paused.add(this.previous);
      this.previous = scope; await this.save();
      if (this.paused.has(scope) || this.options.access()?.client !== access.client) return;
      await this.field.sync(scope);
      const pack = await this.options.vault.open(access.baseUrl, access.user.id);
      if (!pack || pack.scope !== scope || this.options.access()?.client !== access.client) return;
      for (const item of await this.queue.list(pack)) await this.outbox.sync(pack, item.id);
    } finally { this.busy = false; }
  }
}

import { OfflineInput, OfflinePack, LocalNote, LocalSql, ownerKey, scopeKey } from './OfflineModels';
import { ApiError } from '../network/ApiError';
import { normalizeEndpoint } from '../network/Endpoint';
import { initializeOffline } from './OfflineSchema';
import { readLocalPack, confirmLocalPack } from './OfflineScope';
import { selectedDataset } from '../network/DatasetSelection';

export class OfflineVault {
  private db: LocalSql;
  private ready: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  constructor(db: LocalSql) { this.db = db; this.ready = initializeOffline(db); }
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new ApiError('LOCAL_CLOSED', '本地库已关闭，请重新打开随身包。'));
    const next = this.queue.then(async () => { await this.ready; return work(); });
    this.queue = next.then(() => {}, () => {}); return next;
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = this.queue.then(async () => {
      try { await this.ready; } catch (_) { /* Unsupported schema still closes without changing data. */ }
      await this.db.close();
    });
    return this.closing;
  }
  query<T>(work: (db: LocalSql) => Promise<T>): Promise<T> { return this.run(async () => work(this.db)); }
  transact<T>(work: (db: LocalSql) => Promise<T>): Promise<T> {
    return this.run(async () => {
      await this.db.execute('BEGIN TRANSACTION', []);
      try { const result = await work(this.db); await this.db.execute('COMMIT', []); return result; }
      catch (cause) { await this.db.execute('ROLLBACK', []); throw cause as Error; }
    });
  }
  open(baseUrl: string, userId: string): Promise<OfflinePack | null> {
    return this.run(async () => readLocalPack(this.db, baseUrl, userId));
  }
  download(input: OfflineInput): Promise<OfflinePack> {
    return this.run(async () => {
      if (!input.user.id || !Number.isInteger(input.workspace.epoch) || input.workspace.epoch < 1) {
        throw new ApiError('INVALID_SNAPSHOT', '请先完整读取当前身份的数据。');
      }
      const pack: OfflinePack = { baseUrl: normalizeEndpoint(input.baseUrl), datasetId: selectedDataset(),
        user: { id: input.user.id, name: input.user.name, role: input.user.role,
          roleLabel: input.user.roleLabel, buildingIds: input.user.buildingIds },
        workspace: input.workspace, scope: scopeKey(input), downloadedAt: new Date().toISOString() };
      const body = JSON.stringify(pack);
      await this.db.execute('INSERT OR REPLACE INTO offline_packs (owner,body) VALUES (?,?)', [ownerKey(pack.baseUrl, pack.user.id), body]);
      return JSON.parse(body) as OfflinePack;
    });
  }
  private async confirm(pack: OfflinePack): Promise<void> {
    await confirmLocalPack(this.db, pack);
  }
  private async readNote(pack: OfflinePack, taskId: string): Promise<LocalNote | null> {
    const rows = await this.db.read('SELECT body FROM offline_notes WHERE scope=? AND target=?', [pack.scope, taskId]);
    return rows.length ? JSON.parse(rows[0]) as LocalNote : null;
  }
  note(pack: OfflinePack, taskId: string): Promise<LocalNote | null> {
    return this.run(async () => {
      await this.confirm(pack);
      return this.readNote(pack, taskId);
    });
  }
  saveNote(pack: OfflinePack, taskId: string, text: string): Promise<LocalNote> {
    return this.run(async () => {
      await this.confirm(pack);
      const task = pack.workspace.tasks.find((row) => row.id === taskId);
      if (!task) throw new ApiError('OFFLINE_TARGET', '该任务不在随身包中，请先联网下载。');
      if (text.length > 4000) throw new ApiError('OFFLINE_QUOTA', '现场笔记最多4000字。');
      const previous = await this.readNote(pack, taskId);
      const note: LocalNote = { taskId, expectedRev: previous?.expectedRev ?? task.rev, text, updatedAt: new Date().toISOString() };
      await this.db.execute('INSERT OR REPLACE INTO offline_notes (scope,target,body) VALUES (?,?,?)', [pack.scope, taskId, JSON.stringify(note)]);
      return note;
    });
  }
}

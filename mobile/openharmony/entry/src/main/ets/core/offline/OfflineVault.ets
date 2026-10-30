import { OfflineInput, OfflinePack, LocalNote, LocalSql, ownerKey, scopeKey } from './OfflineModels';
import { ApiError } from '../network/ApiError';
import { normalizeEndpoint } from '../network/Endpoint';

export class OfflineVault {
  private db: LocalSql;
  private ready: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  constructor(db: LocalSql) { this.db = db; this.ready = this.initialize(); }
  private async initialize(): Promise<void> {
    await this.db.execute('CREATE TABLE IF NOT EXISTS offline_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)', []);
    const version = await this.db.read('SELECT CAST(version AS TEXT) AS body FROM offline_schema WHERE id=1', []);
    if (version.length && version[0] !== '1') throw new ApiError('OFFLINE_SCHEMA', '离线库版本不支持，请保留数据并更新应用。');
    if (!version.length) await this.db.execute('INSERT INTO offline_schema (id,version) VALUES (1,1)', []);
    await this.db.execute('CREATE TABLE IF NOT EXISTS offline_packs (owner TEXT PRIMARY KEY, body TEXT NOT NULL)', []);
    await this.db.execute('CREATE TABLE IF NOT EXISTS offline_notes (scope TEXT NOT NULL, target TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(scope,target))', []);
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { await this.ready; return work(); });
    this.queue = next.then(() => {}, () => {}); return next;
  }
  close(): Promise<void> { return this.queue.then(() => this.db.close()); }
  private async readPack(baseUrl: string, userId: string): Promise<OfflinePack | null> {
    const rows = await this.db.read('SELECT body FROM offline_packs WHERE owner=?', [ownerKey(baseUrl, userId)]);
    if (!rows.length) return null;
    const pack = JSON.parse(rows[0]) as OfflinePack;
    if (!pack || pack.datasetId !== 'demo-main' || !pack.user || !pack.workspace ||
      ownerKey(pack.baseUrl, pack.user.id) !== ownerKey(baseUrl, userId) || pack.scope !== scopeKey(pack) ||
      !Array.isArray(pack.workspace.tasks) || !Number.isInteger(pack.workspace.epoch)) {
      throw new ApiError('OFFLINE_CORRUPT', '离线随身包不完整，请联网重新下载；原笔记保留。');
    }
    return pack;
  }
  open(baseUrl: string, userId: string): Promise<OfflinePack | null> {
    return this.run(async () => this.readPack(baseUrl, userId));
  }
  download(input: OfflineInput): Promise<OfflinePack> {
    return this.run(async () => {
      if (!input.user.id || !Number.isInteger(input.workspace.epoch) || input.workspace.epoch < 1) {
        throw new ApiError('INVALID_SNAPSHOT', '请先完整读取当前身份的数据。');
      }
      const pack: OfflinePack = { baseUrl: normalizeEndpoint(input.baseUrl), datasetId: 'demo-main',
        user: { id: input.user.id, name: input.user.name, role: input.user.role,
          roleLabel: input.user.roleLabel, buildingIds: input.user.buildingIds },
        workspace: input.workspace, scope: scopeKey(input), downloadedAt: new Date().toISOString() };
      const body = JSON.stringify(pack);
      await this.db.execute('INSERT OR REPLACE INTO offline_packs (owner,body) VALUES (?,?)', [ownerKey(pack.baseUrl, pack.user.id), body]);
      return JSON.parse(body) as OfflinePack;
    });
  }
  private async confirm(pack: OfflinePack): Promise<void> {
    const latest = await this.readPack(pack.baseUrl, pack.user.id);
    if (!latest || latest.scope !== pack.scope) throw new ApiError('OFFLINE_SCOPE_CHANGED', '本地数据版本或身份范围已变化，请重新打开随身包。');
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

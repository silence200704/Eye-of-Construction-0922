import { OfflineVault } from '../OfflineVault';
import { BusinessWrite } from '../../business/BusinessModels';
import { BusinessPhoto } from '../../business/BusinessPhotos';
import { FieldOperation, FieldResult, FieldWorkflow } from './FieldModels';
import { PhotoLink } from '../../../data/models/Reports';
import { LocalSql } from '../OfflineModels';
import { ApiError } from '../../network/ApiError';
import { requestDigest } from '../../business/persistence/RequestDigest';
export class FieldQueue {
  private vault: OfflineVault;
  constructor(vault: OfflineVault) { this.vault = vault; }
  list(scope: string): Promise<FieldOperation[]> {
    return this.vault.query(async (db) => (await db.read('SELECT body FROM field_operations WHERE scope=? ORDER BY rowid', [scope]))
      .map((body) => JSON.parse(body) as FieldOperation));
  }
  private async read(db: LocalSql, id: string, scope: string): Promise<FieldOperation> {
    const rows = await db.read('SELECT body FROM field_operations WHERE id=? AND scope=?', [id, scope]);
    if (!rows.length) throw new ApiError('NOT_FOUND', '本地操作不在当前身份范围。');
    return JSON.parse(rows[0]) as FieldOperation;
  }
  enqueue(scope: string, write: BusinessWrite, dependencies: string[], photos: BusinessPhoto[] = []): Promise<FieldOperation> {
    if (!['task', 'order', 'issue', 'maintenance'].includes(write.kind)) return Promise.reject(new Error('此动作只能联网办理。'));
    return this.vault.transact(async (db) => {
      for (const id of dependencies) await this.read(db, id, scope);
      const digest = requestDigest(JSON.stringify([scope, write, dependencies, photos.map((photo) => `${photo.draftId}:${photo.sha256}:${photo.kind}`)]));
      const id = `field-${digest}`;
      const existing = await db.read('SELECT body FROM field_operations WHERE id=? AND scope=?', [id, scope]);
      if (existing.length) return JSON.parse(existing[0]) as FieldOperation;
      const row: FieldOperation = { id, scope, write, dependencies: [...dependencies], photos,
        body: '', key: `${id}-commit`, phase: 'queued', attempts: 0, nextAttempt: 0, message: '已保存在本机，等待同步。', result: '', sent: false };
      await db.execute('INSERT INTO field_operations (id,scope,body) VALUES (?,?,?)', [row.id, scope, JSON.stringify(row)]);
      return JSON.parse(JSON.stringify(row)) as FieldOperation;
    });
  }
  workflow(plan: FieldWorkflow): Promise<void> {
    return this.vault.transact(async (db) => {
      for (let index = 0; index < plan.writes.length; index++) {
        const id = `${plan.id}-${index}`, write = plan.writes[index];
        const existing = await db.read('SELECT body FROM field_operations WHERE id=? AND scope=?', [id, plan.scope]);
        if (existing.length) {
          if (JSON.stringify((JSON.parse(existing[0]) as FieldOperation).write) !== JSON.stringify(write)) throw new Error('原流程内容已冻结，不能覆盖。');
          continue;
        }
        const row: FieldOperation = { id, scope: plan.scope, write, dependencies: index ? [`${plan.id}-${index - 1}`] : [],
          photos: write.path.endsWith('/issues') ? plan.photos : [], body: '', key: `${id}-commit`, phase: 'queued',
          attempts: 0, nextAttempt: 0, message: '已保存待同步流程，服务端尚未确认。', result: '', sent: false };
        await db.execute('INSERT INTO field_operations (id,scope,body) VALUES (?,?,?)', [id, row.scope, JSON.stringify(row)]);
      }
    });
  }
  update(row: FieldOperation): Promise<void> {
    const body = JSON.stringify(row);
    return this.vault.transact(async (db) => {
      const old = await this.read(db, row.id, row.scope);
      if (old.key !== row.key || JSON.stringify(old.write) !== JSON.stringify(row.write) ||
        JSON.stringify(old.dependencies) !== JSON.stringify(row.dependencies) || (old.body && old.body !== row.body)) {
        throw new ApiError('FROZEN_COMMAND', '已冻结请求不能修改。');
      }
      if (row.body && row.requestHash !== requestDigest(row.body)) throw new Error('本地请求校验失败，已停止提交。');
      await db.execute('UPDATE field_operations SET body=? WHERE id=? AND scope=?', [body, row.id, row.scope]);
    });
  }
  async retry(id: string, scope: string): Promise<void> {
    const row = (await this.list(scope)).find((item) => item.id === id);
    if (!row || ['done', 'conflict', 'failed', 'isolated', 'cancelled'].includes(row.phase)) throw new Error('此操作须先核对内容或版本。');
    row.attempts = 0; row.nextAttempt = 0; await this.update(row);
  }
  async abandon(id: string, scope: string): Promise<void> {
    const rows = await this.list(scope), row = rows.find((item) => item.id === id);
    if (!row || !['conflict', 'failed'].includes(row.phase)) throw new Error('结果未知时必须先核验原请求。');
    const cancelled = new Set<string>([id]);
    for (const item of rows) {
      if (item.id === id || item.dependencies.some((parent) => cancelled.has(parent))) {
        if (item.sent && item.id !== id) throw new Error('后续已有发送请求，请先核验结果。');
        item.phase = 'cancelled'; item.message = '已明确放弃旧办理，内容与原请求保留。'; await this.update(item); cancelled.add(item.id);
      }
    }
  }
  prepare(id: string, scope: string): Promise<FieldOperation | null> {
    return this.vault.transact(async (db) => {
      const row = await this.read(db, id, scope);
      if (row.body && row.requestHash !== requestDigest(row.body)) throw new Error('本地请求校验失败，已停止提交。');
      if (['done', 'conflict', 'failed', 'isolated', 'cancelled'].includes(row.phase)) return null;
      const parents: FieldOperation[] = [];
      for (const dependency of row.dependencies) {
        const parent = await this.read(db, dependency, scope);
        if (parent.phase !== 'done') return null;
        const result = JSON.parse(parent.result) as FieldResult;
        if (result.attempt?.passed === false) return null;
        parents.push(parent);
      }
      if (!row.body && row.photos.every((photo) => !!photo.mediaId)) {
        const body = JSON.parse(row.write.body) as Record<string, Object | null>;
        for (const parent of parents) {
          const result = JSON.parse(parent.result) as FieldResult;
          const target = row.write.kind === 'order' ? result.order : row.write.kind === 'issue' ? result.issue : result.task;
          if (target?.id === row.write.targetId) body['expectedRev'] = target.rev;
          if (row.write.path.endsWith('/complete-point') && result.issue?.id) body['linkedIssueId'] = result.issue.id;
        }
        if (row.photos.length) body['photos'] = row.photos.map((photo): PhotoLink => ({ mediaId: photo.mediaId, draftId: photo.draftId, kind: photo.kind }));
        row.body = JSON.stringify(body);
        row.requestHash = requestDigest(row.body);
        await db.execute('UPDATE field_operations SET body=? WHERE id=? AND scope=?', [JSON.stringify(row), id, scope]);
      }
      return row;
    });
  }
}

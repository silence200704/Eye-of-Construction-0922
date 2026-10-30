import { OfflineVault } from '../OfflineVault';
import { OfflinePack, LocalSql } from '../OfflineModels';
import { confirmLocalPack } from '../OfflineScope';
import { OfflineReport, OfflineOperation } from './QueueModels';
import { ReportDraft, reportId } from '../../report/ReportDraft';
import { ApiError } from '../../network/ApiError';

async function reportRow(db: LocalSql, pack: OfflinePack, id: string): Promise<OfflineReport> {
  const rows = await db.read('SELECT body FROM offline_reports WHERE id=? AND scope=?', [id, pack.scope]);
  if (!rows.length) throw new ApiError('LOCAL_NOT_FOUND', '本地草稿不在当前范围。');
  return JSON.parse(rows[0]) as OfflineReport;
}
function validate(draft: OfflineReport): void {
  const report = new ReportDraft(draft.target); report.anomalyType = draft.anomalyType; report.description = draft.description;
  const message = report.validateText(); if (message) throw new ApiError('LOCAL_VALIDATION', message);
  if (draft.photos.length > 3 || draft.photos.reduce((sum, photo) => sum + photo.size, 0) > 600 * 1024 ||
    draft.photos.some((photo) => photo.size <= 0 || photo.size > 200 * 1024 || !/^[a-f0-9]{64}$/.test(photo.sha256)) ||
    new Set(draft.photos.map((photo) => photo.draftId)).size !== draft.photos.length) throw new ApiError('PHOTO_QUOTA', '照片不完整或超过3张/600KB配额。');
}
export class OutboxStore {
  private vault: OfflineVault;
  constructor(vault: OfflineVault) { this.vault = vault; }
  create(pack: OfflinePack, pointId: string): Promise<OfflineReport> {
    return this.vault.transact(async (db) => {
      await confirmLocalPack(db, pack);
      const point = pack.workspace.points.find((row) => row.id === pointId && row.status === 'active');
      if (!point) throw new ApiError('LOCAL_TARGET', '测点不在随身包内，请先下载。');
      const draft: OfflineReport = { id: `offline-${reportId()}`, scope: pack.scope,
        target: { pointId: point.id, buildingId: point.buildingId, floorId: point.floorId, taskId: '', expectedRev: 0 },
        anomalyType: '', description: '', photos: [], phase: 'editing', updatedAt: new Date().toISOString() };
      await db.execute('INSERT INTO offline_reports (id,scope,body) VALUES (?,?,?)', [draft.id, pack.scope, JSON.stringify(draft)]);
      return draft;
    });
  }
  save(pack: OfflinePack, input: OfflineReport): Promise<void> {
    return this.vault.transact(async (db) => {
      await confirmLocalPack(db, pack); const previous = await reportRow(db, pack, input.id);
      if (previous.phase !== 'editing') throw new ApiError('FROZEN_OPERATION', '该草稿已入队，不能修改固定请求；请另建新上报。');
      const draft: OfflineReport = { id: previous.id, scope: pack.scope, target: previous.target,
        anomalyType: input.anomalyType.slice(0, 80), description: input.description.slice(0, 4000),
        photos: input.photos, phase: 'editing', updatedAt: new Date().toISOString() };
      if (draft.photos.length > 3 || draft.photos.reduce((sum, photo) => sum + photo.size, 0) > 600 * 1024) throw new ApiError('PHOTO_QUOTA', '照片超过3张/600KB配额。');
      await db.execute('UPDATE offline_reports SET body=? WHERE id=? AND scope=?', [JSON.stringify(draft), draft.id, pack.scope]);
    });
  }
  drafts(pack: OfflinePack): Promise<OfflineReport[]> {
    return this.vault.query(async (db) => { await confirmLocalPack(db, pack);
      return (await db.read('SELECT body FROM offline_reports WHERE scope=? ORDER BY id', [pack.scope])).map((body) => JSON.parse(body) as OfflineReport); });
  }
  list(pack: OfflinePack): Promise<OfflineOperation[]> {
    return this.vault.query(async (db) => { await confirmLocalPack(db, pack);
      return (await db.read('SELECT body FROM offline_operations WHERE scope=? ORDER BY id', [pack.scope])).map((body) => JSON.parse(body) as OfflineOperation); });
  }
  operation(pack: OfflinePack, id: string): Promise<OfflineOperation> {
    return this.vault.query(async (db) => { await confirmLocalPack(db, pack);
      const rows = await db.read('SELECT body FROM offline_operations WHERE id=? AND scope=?', [id, pack.scope]);
      if (!rows.length) throw new ApiError('LOCAL_NOT_FOUND', '当前范围没有这项同步操作。');
      return JSON.parse(rows[0]) as OfflineOperation; });
  }
  enqueue(pack: OfflinePack, id: string): Promise<OfflineOperation> {
    return this.vault.transact(async (db) => {
      await confirmLocalPack(db, pack); const draft = await reportRow(db, pack, id);
      const existing = await db.read('SELECT body FROM offline_operations WHERE id=? AND scope=?', [id, pack.scope]);
      if (existing.length) return JSON.parse(existing[0]) as OfflineOperation;
      validate(draft); draft.phase = 'queued';
      const operation: OfflineOperation = { id, scope: pack.scope, request: draft, phase: 'queued', uploaded: [],
        commitKey: `${id}-commit`, commitBody: '', attempts: 0, nextAttemptAt: 0, uncertain: false,
        message: '待同步，尚未提交服务端。', issueId: '', issueNo: '' };
      await db.execute('INSERT INTO offline_operations (id,scope,body) VALUES (?,?,?)', [id, pack.scope, JSON.stringify(operation)]);
      await db.execute('UPDATE offline_reports SET body=? WHERE id=? AND scope=?', [JSON.stringify(draft), id, pack.scope]);
      return operation;
    });
  }
  progress(pack: OfflinePack, operation: OfflineOperation): Promise<void> {
    return this.vault.transact(async (db) => {
      await confirmLocalPack(db, pack);
      const rows = await db.read('SELECT body FROM offline_operations WHERE id=? AND scope=?', [operation.id, pack.scope]);
      if (!rows.length) throw new ApiError('LOCAL_NOT_FOUND', '同步操作不存在。');
      const previous = JSON.parse(rows[0]) as OfflineOperation;
      if (JSON.stringify(previous.request) !== JSON.stringify(operation.request) || previous.commitKey !== operation.commitKey ||
        (previous.commitBody && previous.commitBody !== operation.commitBody)) throw new ApiError('FROZEN_OPERATION', '固定请求内容不可变。');
      await db.execute('UPDATE offline_operations SET body=? WHERE id=? AND scope=?', [JSON.stringify(operation), operation.id, pack.scope]);
      if (operation.phase === 'done') { const draft = await reportRow(db, pack, operation.id); draft.phase = 'done';
        await db.execute('UPDATE offline_reports SET body=? WHERE id=? AND scope=?', [JSON.stringify(draft), draft.id, pack.scope]); }
    });
  }
}

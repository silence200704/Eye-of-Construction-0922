import { OfflinePack, LocalSql, ownerKey, scopeKey } from './OfflineModels';
import { ApiError } from '../network/ApiError';

export async function readLocalPack(db: LocalSql, baseUrl: string, userId: string): Promise<OfflinePack | null> {
  const rows = await db.read('SELECT body FROM offline_packs WHERE owner=?', [ownerKey(baseUrl, userId)]);
  if (!rows.length) return null;
  const pack = JSON.parse(rows[0]) as OfflinePack;
  if (!pack || pack.datasetId !== 'demo-main' || !pack.user || !pack.workspace ||
    ownerKey(pack.baseUrl, pack.user.id) !== ownerKey(baseUrl, userId) || pack.scope !== scopeKey(pack) ||
    !Array.isArray(pack.workspace.tasks) || !Number.isInteger(pack.workspace.epoch)) {
    throw new ApiError('OFFLINE_CORRUPT', '离线随身包不完整，请联网重新下载；原笔记保留。');
  }
  return pack;
}
export async function confirmLocalPack(db: LocalSql, pack: OfflinePack): Promise<void> {
  const latest = await readLocalPack(db, pack.baseUrl, pack.user.id);
  if (!latest || latest.scope !== pack.scope || pack.scope !== scopeKey(pack)) {
    throw new ApiError('OFFLINE_SCOPE_CHANGED', '本地数据版本或身份范围已变化，请重新打开随身包。');
  }
}

import { LocalSql } from './OfflineModels';
import { ApiError } from '../network/ApiError';

export async function initializeOffline(db: LocalSql): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS offline_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)', []);
  const version = await db.read('SELECT CAST(version AS TEXT) AS body FROM offline_schema WHERE id=1', []);
  if (version.length && !['1', '2', '3'].includes(version[0])) throw new ApiError('OFFLINE_SCHEMA', '离线库版本不支持，请保留数据并更新应用。');
  await db.execute('BEGIN TRANSACTION', []);
  try {
    await db.execute('CREATE TABLE IF NOT EXISTS offline_packs (owner TEXT PRIMARY KEY, body TEXT NOT NULL)', []);
    await db.execute('CREATE TABLE IF NOT EXISTS offline_notes (scope TEXT NOT NULL, target TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(scope,target))', []);
    await db.execute('CREATE TABLE IF NOT EXISTS offline_reports (id TEXT PRIMARY KEY, scope TEXT NOT NULL, body TEXT NOT NULL)', []);
    await db.execute('CREATE TABLE IF NOT EXISTS offline_operations (id TEXT PRIMARY KEY, scope TEXT NOT NULL, body TEXT NOT NULL)', []);
    await db.execute('CREATE TABLE IF NOT EXISTS business_forms (scope TEXT NOT NULL, target TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(scope,target))', []);
    await db.execute('CREATE TABLE IF NOT EXISTS business_commands (id TEXT PRIMARY KEY, scope TEXT NOT NULL, body TEXT NOT NULL)', []);
    await db.execute('CREATE TABLE IF NOT EXISTS field_operations (id TEXT PRIMARY KEY, scope TEXT NOT NULL, body TEXT NOT NULL)', []);
    await db.execute('INSERT OR REPLACE INTO offline_schema (id,version) VALUES (1,3)', []);
    await db.execute('COMMIT', []);
  } catch (cause) { await db.execute('ROLLBACK', []); throw cause as Error; }
}

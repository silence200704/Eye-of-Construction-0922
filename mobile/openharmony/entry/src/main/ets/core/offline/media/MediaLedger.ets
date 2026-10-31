import { OfflineVault } from '../OfflineVault';
export interface MediaEntry { id: string; path: string; phase: string; at: number; scope: string; }
export interface MediaRemover { remove: (id: string, path: string) => void; }
export class MediaLedger {
  private vault: OfflineVault;
  constructor(vault: OfflineVault) { this.vault = vault; }
  record(entry: MediaEntry): Promise<void> {
    const body = JSON.stringify(entry);
    return this.vault.transact(async (db) => {
      const existing = await db.read('SELECT body FROM offline_files WHERE id=?', [entry.id]);
      if (existing.length) {
        const old = JSON.parse(existing[0]) as MediaEntry;
        if (old.scope !== entry.scope || old.path !== entry.path) throw new Error('照片标识已属于另一份草稿，原文件保留。');
      }
      await db.execute('INSERT OR REPLACE INTO offline_files (id,scope,body) VALUES (?,?,?)', [entry.id, entry.scope, body]);
    });
  }
  collect(scope: string, files: MediaRemover): Promise<number> {
    return this.vault.transact(async (db) => {
      const rows = await db.read('SELECT body FROM offline_files WHERE scope=?', [scope]);
      let removed = 0;
      const tables: string[] = ['business_forms', 'business_commands', 'field_operations', 'offline_reports', 'offline_operations'];
      const references: string[] = [];
      for (const table of tables) references.push(...await db.read(`SELECT body FROM ${table}`, []));
      for (const body of rows) {
        const entry = JSON.parse(body) as MediaEntry;
        if (Date.now() - entry.at < 7 * 86400000 || references.some((ref) => ref.includes(JSON.stringify(entry.path)))) continue;
        files.remove(entry.id, entry.path);
        await db.execute('DELETE FROM offline_files WHERE id=? AND scope=?', [entry.id, scope]); removed++;
      }
      return removed;
    });
  }
}

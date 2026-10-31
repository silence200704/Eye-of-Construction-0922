import { OfflineVault } from '../offline/OfflineVault';
import { PendingBusiness, BusinessJournal } from './BusinessModels';
import { ApiError } from '../network/ApiError';
import { requestDigest } from './persistence/RequestDigest';

export class BusinessStore {
  private vault: OfflineVault;
  constructor(vault: OfflineVault) { this.vault = vault; }
  journal(): BusinessJournal { return { load: async (scope) => this.pending(scope), save: async (pending) => this.save(pending) }; }
  async pending(scope: string): Promise<PendingBusiness | null> {
    const rows = await this.commands(scope);
    return rows.find((row) => ['prepared', 'sending', 'unknown'].includes(row.phase)) ?? null;
  }
  commands(scope: string): Promise<PendingBusiness[]> {
    return this.vault.query(async (db) => (await db.read('SELECT body FROM business_commands WHERE scope=? ORDER BY rowid', [scope]))
      .map((body) => {
        const row = JSON.parse(body) as PendingBusiness;
        if (row.requestHash && row.requestHash !== requestDigest(row.write.body)) throw new Error('本地请求校验失败，请保留数据。');
        return row;
      }));
  }
  save(pending: PendingBusiness): Promise<void> {
    pending.requestHash = requestDigest(pending.write.body);
    const body = JSON.stringify(pending);
    return this.vault.transact(async (db) => {
      const rows = await db.read('SELECT body FROM business_commands WHERE id=?', [pending.key]);
      const previous = rows.length ? JSON.parse(rows[0]) as PendingBusiness : null;
      if (previous && (previous.scope !== pending.scope || JSON.stringify(previous.write) !== JSON.stringify(pending.write))) {
        throw new ApiError('FROZEN_COMMAND', '已冻结的请求不能修改，请核验原请求。');
      }
      await db.execute('INSERT OR REPLACE INTO business_commands (id,scope,body) VALUES (?,?,?)', [pending.key, pending.scope, body]);
    });
  }
  saveForm(scope: string, target: string, body: string): Promise<void> {
    return this.vault.query(async (db) => { await db.execute('INSERT OR REPLACE INTO business_forms (scope,target,body) VALUES (?,?,?)', [scope, target, body]); });
  }
  form(scope: string, target: string): Promise<string> {
    return this.vault.query(async (db) => {
      const rows = await db.read('SELECT body FROM business_forms WHERE scope=? AND target=?', [scope, target]);
      return rows[0] ?? '';
    });
  }
}

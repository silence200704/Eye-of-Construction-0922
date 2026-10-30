import common from '@ohos.app.ability.common';
import relationalStore from '@ohos.data.relationalStore';
import { LocalSql } from './OfflineModels';

export class NativeLocalSql implements LocalSql {
  private store: Promise<relationalStore.RdbStore>;
  constructor(context: common.UIAbilityContext) {
    this.store = relationalStore.getRdbStore(context, { name: 'zhutong_offline.db', securityLevel: relationalStore.SecurityLevel.S1 });
  }
  async execute(sql: string, args: string[]): Promise<void> { await (await this.store).executeSql(sql, args); }
  async read(sql: string, args: string[]): Promise<string[]> {
    const rows = await (await this.store).querySql(sql, args);
    try {
      const result: string[] = [];
      while (rows.goToNextRow()) result.push(rows.getString(rows.getColumnIndex('body')));
      return result;
    } finally { rows.close(); }
  }
  async close(): Promise<void> { await (await this.store).close(); }
}

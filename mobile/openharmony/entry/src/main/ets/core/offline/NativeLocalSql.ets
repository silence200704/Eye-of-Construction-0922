import common from '@ohos.app.ability.common';
import relationalStore from '@ohos.data.relationalStore';
import { LocalSql } from './OfflineModels';

export class NativeLocalSql implements LocalSql {
  private store: Promise<relationalStore.RdbStore>;
  constructor(context: common.UIAbilityContext) {
    this.store = relationalStore.getRdbStore(context, { name: 'zhutong_offline.db', securityLevel: relationalStore.SecurityLevel.S1 });
  }
  async execute(sql: string, args: string[]): Promise<void> {
    const store = await this.store;
    // RDB 的 executeSql 不支持事务控制语句；用原生事务接口，否则初始化和离线写入会失败。
    if (sql === 'BEGIN TRANSACTION') { store.beginTransaction(); return; }
    if (sql === 'COMMIT') { store.commit(); return; }
    if (sql === 'ROLLBACK') { store.rollBack(); return; }
    await store.executeSql(sql, args);
  }
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

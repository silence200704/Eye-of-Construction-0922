import common from '@ohos.app.ability.common';
import relationalStore from '@ohos.data.relationalStore';
import fs from '@ohos.file.fs';
import { CapabilityReport } from './ProbeModels';

const STORE: relationalStore.StoreConfig = {
  name: 'native_capability_probe.db', securityLevel: relationalStore.SecurityLevel.S1
};

async function readRun(store: relationalStore.RdbStore): Promise<number> {
  const rows = await store.querySql('SELECT run FROM probe_state WHERE id = 1');
  try {
    return rows.goToFirstRow() ? rows.getLong(rows.getColumnIndex('run')) : 0;
  } finally {
    rows.close();
  }
}

export async function probeDatabase(context: common.UIAbilityContext): Promise<number[]> {
  const store = await relationalStore.getRdbStore(context, STORE);
  let previous = 0;
  try {
    await store.executeSql('CREATE TABLE IF NOT EXISTS probe_state (id INTEGER PRIMARY KEY, run INTEGER NOT NULL)');
    previous = await readRun(store);
    await store.executeSql('INSERT OR REPLACE INTO probe_state (id, run) VALUES (1, ?)', [previous + 1]);
  } finally {
    await store.close();
  }
  const reopened = await relationalStore.getRdbStore(context, STORE);
  try {
    return [previous, await readRun(reopened)];
  } finally {
    await reopened.close();
  }
}

export function probeFile(directory: string): boolean {
  const path = `${directory}/native-probe-marker.txt`;
  const marker = `筑瞳本地文件核验 ${new Date().toISOString()}`;
  const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try {
    fs.writeSync(file.fd, marker);
  } finally {
    fs.closeSync(file.fd);
  }
  return fs.readTextSync(path) === marker;
}

export function saveCapabilities(directory: string, report: CapabilityReport): void {
  const path = `${directory}/native-capability-report.json`;
  const file = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try {
    fs.writeSync(file.fd, JSON.stringify(report));
  } finally {
    fs.closeSync(file.fd);
  }
}

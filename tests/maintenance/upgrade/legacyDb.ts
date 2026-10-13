import Dexie from 'dexie'
import {
  SCHEMA_V1_STORES,
  SCHEMA_V2_STORES,
  SCHEMA_V3_STORES,
  SCHEMA_V4_STORES,
} from '@/db/database'

type Schema = Record<string, string>

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function createStore(db: IDBDatabase, table: string, definition: string): void {
  const fields = definition.split(',').map((item) => item.trim())
  const primary = fields.shift()?.replace('&', '')
  if (primary === undefined || primary === '') throw new Error(`缺少 ${table} 主键定义`)
  const store = db.createObjectStore(table, { keyPath: primary })
  for (const field of fields) {
    const name = field.replace('&', '')
    store.createIndex(name, name, { unique: field.startsWith('&') })
  }
}

/**
 * 创建真实应用 v4 的原生 IndexedDB 库。
 * Dexie 的应用版本 4 对应物理版本 40，不能误写成 4。
 */
export async function createNativeApplicationV4(name: string): Promise<void> {
  await Dexie.delete(name)
  const request = indexedDB.open(name, 40)
  request.onupgradeneeded = () => {
    const native = request.result
    const schemas: Schema[] = [SCHEMA_V1_STORES, SCHEMA_V2_STORES, SCHEMA_V3_STORES, SCHEMA_V4_STORES]
    for (const schema of schemas) {
      for (const [table, definition] of Object.entries(schema)) {
        if (!native.objectStoreNames.contains(table)) createStore(native, table, definition)
      }
    }
  }
  const native = await requestDone(request)
  const tx = native.transaction(['buildings', 'points', 'records', 'events', 'plans', 'issues'], 'readwrite')
  tx.objectStore('buildings').put({ id: 'b_old', code: 'BOLD', name: '旧库实验楼', status: 'active' })
  tx.objectStore('points').put({ id: 'p_old', code: 'POLD', name: '旧裂缝点', buildingId: 'b_old', floorId: 'f_old', status: 'active' })
  tx.objectStore('records').put({ id: 'r_old', recordNo: 'R-OLD-001', pointId: 'p_old', sampleTime: '2026-09-20T09:00:00.000Z' })
  tx.objectStore('events').put({ id: 'e_old', eventNo: 'E-OLD-001', pointId: 'p_old', ruleId: 'rule_old', status: 'closed' })
  tx.objectStore('plans').put({ id: 'plan_old', code: 'PLAN-OLD-001', buildingId: 'b_old', kind: 'patrol' })
  tx.objectStore('issues').put({ id: 'iss_old', issueNo: 'ISS-OLD-001', source: 'report', pointId: 'p_old', eventId: null, taskId: null, status: 'closed', createdAt: '2026-09-20T09:00:00.000Z' })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  native.close()
}

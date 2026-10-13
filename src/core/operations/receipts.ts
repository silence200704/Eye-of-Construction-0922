/** 观察原事务：提交完成后重读，不改变事务边界或业务表。 */
import Dexie, { type Transaction } from 'dexie'
import { shallowRef } from 'vue'
import { statusLabelOf, type StatusResource } from '@/api/contract/states'
import { workspaceStorageKey } from '@/core/demo/workspace'

export interface OperationReceipt {
  id: string; resource: string; number: string; before: string; after: string
  actor: string; at: string; action: string; attachmentCount: number
  result: '创建' | '更新' | '复用'; path: string; query: Record<string,string>
}
type Row = Record<string, unknown>
interface Change { table: string; id: string; before: string; row: Row }
interface Batch { changes: Map<string,Change>; logs: Row[] }
const resources: Record<string,StatusResource> = { events: 'event', issues: 'issue', workOrders: 'workOrder', tasks: 'task', maintenanceTasks: 'maintenance' }
const KEY = workspaceStorageKey('zhutong-demo/operation-receipts')
function restore(): OperationReceipt[] {
  try {
    if (import.meta.env.MODE === 'test') return []
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter(row => row && typeof row.id === 'string' && typeof row.at === 'string').slice(-100) : []
  } catch { return [] }
}
export const receipts = shallowRef<OperationReceipt[]>(restore())
function update(next: OperationReceipt[]): void {
  receipts.value = next
  try { if (import.meta.env.MODE !== 'test') localStorage.setItem(KEY,JSON.stringify(next)) } catch { /* 缓存失败不影响业务提交与当前回执。 */ }
}
export function clearReceipts(): void { update([]) }
let pending: Promise<void> = Promise.resolve()
export async function flushReceipts(): Promise<void> { await pending }
function attachmentIds(row: Row): string[] {
  const reviews = Array.isArray(row.reviews) ? row.reviews as Row[] : []
  const execution = row.execution as Row | undefined
  return [...new Set([...(Array.isArray(row.photos) ? row.photos : []), ...reviews.flatMap(r => Array.isArray(r.photos) ? r.photos : []),
    ...(Array.isArray(execution?.photos) ? execution.photos : [])].filter((id): id is string => typeof id === 'string'))]
}
function destination(table: string, id: string): Pick<OperationReceipt,'path'|'query'> {
  if (table === 'events') return { path: '/alarms', query: { event: id } }
  if (table === 'issues') return { path: '/issues', query: { issue: id } }
  if (table === 'workOrders') return { path: '/issues', query: { workOrder: id } }
  return { path: table === 'tasks' ? '/inspection' : '/maintenance', query: { task: id } }
}
async function publish(db: Dexie, batch: Batch): Promise<void> {
  for (const change of batch.changes.values()) {
    const log = [...batch.logs].reverse().find(row => row.objectId === change.id)
    if (!log || !(await db.table(change.table).get(change.id))) continue
    const ids = attachmentIds(change.row)
    const photos = db.tables.some(t => t.name === 'attachments') ? (await db.table('attachments').toArray() as Row[])
      .filter(row => ids.includes(String(row.id)) || row.issueId === change.id || row.workOrderId === change.id || row.maintenanceTaskId === change.id) : []
    const resource = resources[change.table]!
    const receipt: OperationReceipt = {
      id: change.id, resource, number: String(change.row.eventNo ?? change.row.issueNo ?? change.row.orderNo ?? change.row.taskNo ?? change.id),
      before: change.before ? statusLabelOf(resource,change.before) : '未创建', after: statusLabelOf(resource,String(change.row.status ?? '')),
      actor: String(log.actor ?? ''), at: String(log.at ?? ''), action: String(log.summary ?? ''), attachmentCount: photos.filter(Boolean).length,
      result: change.before ? '更新' : '创建', ...destination(change.table,change.id),
    }
    update([...receipts.value.slice(-99),receipt])
  }
}
export function installReceipts(db: Dexie): void {
  const batches = new WeakMap<Transaction,Batch>()
  function batch(tx: Transaction): Batch {
    let entry = batches.get(tx)
    if (!entry) {
      entry = { changes: new Map(), logs: [] }; batches.set(tx,entry)
      const captured = entry
      tx.on('complete',() => { pending = pending.then(() => Dexie.ignoreTransaction(() => publish(db,captured))).catch(() => {}) })
    }
    return entry
  }
  function capture(table: string, row: Row, tx: Transaction, old?: Row): void {
    const entry = batch(tx)
    if (table === 'audits') { entry.logs.push(row); return }
    const id = String(row.id), key = `${table}/${id}`
    const previous = entry.changes.get(key)
    entry.changes.set(key,{ table,id,before: previous?.before ?? String(old?.status ?? ''), row })
  }
  for (const table of db.tables.filter(t => resources[t.name] || t.name === 'audits')) {
    table.hook('creating',(_key,row: Row,tx) => { capture(table.name,{ ...row },tx) })
    table.hook('updating',(changes,_key,old: Row,tx) => {
      const row = structuredClone(old)
      Object.entries(changes).forEach(([path,value]) => Dexie.setByKeyPath(row,path,value))
      capture(table.name,row,tx,old)
    })
  }
}

/** 幂等命中没有新写入：显示既有实体的上次真实回执，明确复用。 */
export async function publishReuse(input: { db: Dexie; id: string; actor: string; at: string }): Promise<void> {
  await flushReceipts()
  const row = await input.db.table('issues').get(input.id) as Row | undefined
  if (!row) return
  await publish(input.db,{ changes: new Map([[input.id,{ table: 'issues', id: input.id, before: String(row.status), row }]]),
    logs: [{ objectId: input.id, actor: input.actor, at: input.at, summary: '同一次提交已存在，复用既有问题，未重复建单' }] })
  const last = receipts.value[receipts.value.length - 1]
  if (last?.id === input.id) update([...receipts.value.slice(0,-1),{ ...last, result: '复用' }])
}

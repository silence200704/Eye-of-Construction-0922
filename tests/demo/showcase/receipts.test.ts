import Dexie from 'dexie'
import { afterEach, expect, it } from 'vitest'
import { installReceipts, flushReceipts, receipts } from '@/core/operations/receipts'

const databases: Dexie[] = []
afterEach(async () => { await Promise.all(databases.map(db => db.delete())); receipts.value = [] })
it('只为已提交事务生成回执，失败事务不宣布成功，附件数取实际保存行', async () => {
  const db = new Dexie('receipt-test')
  databases.push(db)
  db.version(1).stores({ issues: 'id', audits: 'id', attachments: 'id' })
  installReceipts(db)
  await db.table('issues').add({ id: 'i', issueNo: 'I-1', status: 'pending_review', photos: [] })
  await db.transaction('rw',db.tables,async () => {
    await db.table('issues').put({ id: 'i', issueNo: 'I-1', status: 'closed', photos: ['p','missing'] })
    await db.table('attachments').put({ id: 'p' })
    await db.table('audits').put({ id: 'a', objectId: 'i', actor: '安全员', at: '2026-10-08', summary: '提交复查' })
  })
  await flushReceipts()
  expect(receipts.value[0]).toMatchObject({ number: 'I-1', before: '待审核', after: '已关闭', actor: '安全员', attachmentCount: 1 })
  await expect(db.transaction('rw',db.tables,async () => {
    await db.table('issues').update('i',{ status: 'pending_review' })
    await db.table('audits').put({ id: 'b', objectId: 'i', actor: '安全员', at: '2026-10-08', summary: '失败提交' })
    throw new Error('回滚')
  })).rejects.toThrow('回滚')
  await flushReceipts()
  expect(receipts.value).toHaveLength(1)
})

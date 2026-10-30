import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queueFixture,sql } from './queue-fixture.mjs'
import { native } from '../nativeLoader.mjs'

test('enqueue freezes one operation transactionally and survives real SQLite reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zt-queue-')),path=join(dir,'local.db')
 try {
  const f=await queueFixture(path)
  let draft=await f.store.create(f.pack,'p')
  draft.anomalyType='模拟裂缝';draft.description='比赛模拟：离线观察墙面变化。'
  await f.store.save(f.pack,draft)
  const op=await f.store.enqueue(f.pack,draft.id)
  assert.equal((await f.store.enqueue(f.pack,draft.id)).id,op.id)
  draft.description='不允许改入队内容'
  await assert.rejects(f.store.save(f.pack,draft),/已入队/)
  await f.vault.close()
  const {OfflineVault}=native('core/offline/OfflineVault.ets'),{OutboxStore}=native('core/offline/queue/OutboxStore.ets')
  const vault=new OfflineVault(sql(path)),store=new OutboxStore(vault)
  const restored=await store.operation(f.pack,op.id)
  assert.equal(restored.request.description,'比赛模拟：离线观察墙面变化。')
  assert.equal(restored.commitKey,op.commitKey)
  assert.equal((await store.list(f.pack)).length,1)
  const other={...f.pack,user:{...f.user,id:'other'}}
  await assert.rejects(store.list(other),/不完整|变化/)
  await vault.close()
 } finally {rmSync(dir,{recursive:true,force:true})}
})

test('invalid target or empty draft cannot enqueue; schema migration preserves existing notes',async()=>{
 const f=await queueFixture()
 await assert.rejects(f.store.create(f.pack,'outside'),/不在随身包/)
 const draft=await f.store.create(f.pack,'p')
 await assert.rejects(f.store.enqueue(f.pack,draft.id),/异常类型|描述/)
 const newer=await f.vault.download({...f.pack,workspace:{...f.workspace,epoch:2}})
 assert.equal((await f.store.list(newer)).length,0)
 await assert.rejects(f.store.list(f.pack),/变化/)
 await f.vault.close()
})

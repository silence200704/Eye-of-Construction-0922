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

test('schema 1 upgrades to 2 without erasing notes and failed enqueue rolls back both queue and draft',async()=>{
 const {OfflineVault}=native('core/offline/OfflineVault.ets'),db=sql()
 await db.execute('CREATE TABLE offline_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)')
 await db.execute('INSERT INTO offline_schema VALUES (1,1)')
 await db.execute('CREATE TABLE offline_notes (scope TEXT NOT NULL,target TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,target))')
 await db.execute('INSERT INTO offline_notes VALUES (?,?,?)',['old','t','original-note'])
 const vault=new OfflineVault(db);assert.equal(await vault.open('http://localhost:8080','user'),null)
 assert.deepEqual(await db.read('SELECT CAST(version AS TEXT) AS body FROM offline_schema'),['2'])
 assert.deepEqual(await db.read('SELECT body FROM offline_notes'),['original-note']);await vault.close()
 const f=await queueFixture();const draft=await f.store.create(f.pack,'p')
 draft.anomalyType='模拟';draft.description='原稿'
 await f.store.save(f.pack,draft)
 const execute=f.db.execute;let fail=true
 f.db.execute=async(query,args)=>{if(fail&&query.startsWith('UPDATE offline_reports'))throw Error('disk full');return execute(query,args)}
 await assert.rejects(f.store.enqueue(f.pack,draft.id),/disk full/)
 assert.equal((await f.store.list(f.pack)).length,0)
 assert.equal((await f.store.drafts(f.pack))[0].phase,'editing')
 fail=false;await f.store.enqueue(f.pack,draft.id)
 assert.equal((await f.store.list(f.pack)).length,1);await f.vault.close()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { native } from '../nativeLoader.mjs'
import { identity } from '../fixture.mjs'

function driver(path) {
  const db = new DatabaseSync(path)
  return { execute: async (sql,args=[]) => { db.prepare(sql).run(...args) },
    read: async (sql,args=[]) => db.prepare(sql).all(...args).map(row=>row.body), close: async()=>db.close() }
}
function snapshot(epoch=1,user=identity()) {
  return {baseUrl:'http://localhost:8080',user,workspace:{epoch,buildings:[],floors:[],points:[],devices:[],records:[],events:[],issues:[],orders:[],supplementableIds:[],tasks:[{id:'t',taskNo:'T1',rev:3,planSnapshot:{pointIds:['p']}}]}}
}

test('a real SQLite file survives close/reopen with an identity-scoped snapshot and local-only task note',async()=>{
  const {OfflineVault}=native('core/offline/OfflineVault.ets')
  const folder=mkdtempSync(join(tmpdir(),'zhutong-offline-')),path=join(folder,'offline.db')
  try {
    let vault=new OfflineVault(driver(path));const input=snapshot()
    input.token='must-not-persist'
    const pack=await vault.download(input)
    await vault.saveNote(pack,'t','离线现场观察，不是已提交检查')
    await vault.close()
    vault=new OfflineVault(driver(path))
    const restored=await vault.open(input.baseUrl,input.user.id)
    assert.equal(restored.workspace.tasks[0].rev,3)
    assert.equal((await vault.note(restored,'t')).text,'离线现场观察，不是已提交检查')
    assert.equal((await vault.note(restored,'t')).expectedRev,3)
    assert.doesNotMatch(JSON.stringify(restored),/token|must-not-persist/)
    assert.equal(await vault.open(input.baseUrl,'demo-repair'),null)
    assert.equal(await vault.open('http://localhost:9000',input.user.id),null)
    await vault.close()
  } finally {rmSync(folder,{recursive:true,force:true})}
})

test('new epoch or narrowed scope isolates old notes and rejects writes from a stale snapshot',async()=>{
  const {OfflineVault}=native('core/offline/OfflineVault.ets')
  const vault=new OfflineVault(driver(':memory:')),first=await vault.download(snapshot())
  await vault.saveNote(first,'t','旧版本笔记保留')
  const newer=await vault.download(snapshot(2))
  assert.equal(await vault.note(newer,'t'),null)
  await assert.rejects(vault.saveNote(first,'t','不能重绑'),/已变化/)
  await vault.saveNote(newer,'t','新版本笔记')
  const narrowed=await vault.download(snapshot(2,{...identity(),buildingIds:[]}))
  assert.equal(await vault.note(narrowed,'t'),null)
  await assert.rejects(vault.saveNote(newer,'t','不能覆盖'),/已变化/)
  await assert.rejects(vault.saveNote(narrowed,'unknown','错误目标'),/不在随身包/)
  await vault.close()
})

test('unsupported local schema is preserved and never silently cleared',async()=>{
  const {OfflineVault}=native('core/offline/OfflineVault.ets'),db=driver(':memory:')
  await db.execute('CREATE TABLE offline_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)')
  await db.execute('INSERT INTO offline_schema VALUES (1,99)')
  const vault=new OfflineVault(db)
  await assert.rejects(vault.open('http://localhost:8080','demo-safety'),/版本/)
  assert.deepEqual(await db.read('SELECT CAST(version AS TEXT) AS body FROM offline_schema'),['99'])
  await vault.close()
})

test('refreshing the same task never silently rebases an existing note to a newer server revision',async()=>{
 const {OfflineVault}=native('core/offline/OfflineVault.ets'),vault=new OfflineVault(driver(':memory:'))
 const first=await vault.download(snapshot());await vault.saveNote(first,'t','依据版本3')
 const update=snapshot();update.workspace.tasks[0].rev=4
 const latest=await vault.download(update)
 assert.equal((await vault.note(latest,'t')).expectedRev,3)
 assert.equal((await vault.saveNote(latest,'t','继续补充原观察')).expectedRev,3)
 await assert.rejects(vault.saveNote(latest,'t','x'.repeat(4001)),/最多4000/)
 await vault.close()
})

test('corrupt or cross-owner local rows are rejected rather than displayed as another identity',async()=>{
 const {OfflineVault}=native('core/offline/OfflineVault.ets'),db=driver(':memory:'),vault=new OfflineVault(db)
 const pack=await vault.download(snapshot()),key=JSON.stringify([pack.baseUrl,'demo-main',pack.user.id])
 await assert.rejects(vault.download(snapshot(0)),/完整读取/)
 await db.execute('UPDATE offline_packs SET body=? WHERE owner=?',['{',key])
 await assert.rejects(vault.open(pack.baseUrl,pack.user.id))
 const corrupt={...pack,user:{...pack.user,id:'other'}}
 await db.execute('UPDATE offline_packs SET body=? WHERE owner=?',[JSON.stringify(corrupt),key])
 await assert.rejects(vault.open(pack.baseUrl,pack.user.id),/不完整/)
 await vault.close()
})

test('a failed local write leaves the previous note intact and the next save can recover',async()=>{
 const {OfflineVault}=native('core/offline/OfflineVault.ets'),db=driver(':memory:');let fail=false
 const wrapped={...db,execute:async(sql,args)=>{if(fail&&sql.startsWith('INSERT OR REPLACE INTO offline_notes'))throw Error('disk full');return db.execute(sql,args)}}
 const vault=new OfflineVault(wrapped),pack=await vault.download(snapshot())
 await vault.saveNote(pack,'t','已落库')
 fail=true;await assert.rejects(vault.saveNote(pack,'t','不能假报成功'),/disk full/)
 assert.equal((await vault.note(pack,'t')).text,'已落库')
 fail=false;await vault.saveNote(pack,'t','恢复后可保存')
 assert.equal((await vault.note(pack,'t')).text,'恢复后可保存');await vault.close()
})

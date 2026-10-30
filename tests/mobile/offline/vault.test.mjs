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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'
import { queueFixture } from './queue-fixture.mjs'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {sql} from './queue-fixture.mjs'
const bytes=new Uint8Array([1,2,3]).buffer,sha='a'.repeat(64)

async function fixture(path) {
 const f=await queueFixture(path);let draft=await f.store.create(f.pack,'p')
 draft.anomalyType='模拟异常';draft.description='比赛模拟：离线独立上报。'
 draft.photos=[{draftId:'photo1',path:'private/photo1.jpg',uri:'file://private/photo1.jpg',fileName:'photo1.jpg',mimeType:'image/jpeg',source:'album',size:3,sha256:sha}]
 await f.store.save(f.pack,draft);const op=await f.store.enqueue(f.pack,draft.id)
 const calls=[],mediaReceipts=new Map(),issueReceipts=new Map();let failUpload=true,failCommit=true,commits=0,clock=0
 const access={baseUrl:f.pack.baseUrl,user:f.user,workspace:f.workspace,client:{send:async(path,options)=>{
  if(path==='/auth/me')return {data:f.user,meta:{datasetEpoch:1}}
  if(path.endsWith('/archive'))return {data:f.workspace,meta:{datasetEpoch:1}}
  calls.push({path,options})
  if(path.includes('/media?')){
   if(!mediaReceipts.has(options.idempotencyKey))mediaReceipts.set(options.idempotencyKey,{data:{id:'m1',size:3,sha256:sha},meta:{datasetEpoch:1}})
   if(failUpload){failUpload=false;throw Error('upload response lost after commit')}
   return mediaReceipts.get(options.idempotencyKey)
  }
  commits++
  if(!issueReceipts.has(options.idempotencyKey))issueReceipts.set(options.idempotencyKey,{data:{issue:{id:'i1',issueNo:'ISS1',pointId:'p',buildingId:'b',status:'pending_review',rev:1,photos:['a1']}},meta:{datasetEpoch:1}})
  if(failCommit){failCommit=false;throw Error('commit response lost after commit')}
  return issueReceipts.get(options.idempotencyKey)
 }}}
 const {OutboxExecutor}=native('core/offline/queue/OutboxExecutor.ets')
 const executor=new OutboxExecutor({store:f.store,files:{read:async()=>bytes},access:()=>access,now:()=>clock})
 return {...f,op,executor,calls,access,advance:()=>clock+=100000,commits:()=>commits,
   noLoss:()=>{failUpload=false;failCommit=false},effects:()=>[mediaReceipts.size,issueReceipts.size]}
}

test('upload and commit loss retry with fixed keys and body; concurrent clicks do not create operations',async()=>{
 const f=await fixture()
 await Promise.all(Array.from({length:10},()=>f.executor.sync(f.pack,f.op.id)))
 assert.equal((await f.store.operation(f.pack,f.op.id)).phase,'waiting')
 f.advance();await f.executor.sync(f.pack,f.op.id)
 const unknown=await f.store.operation(f.pack,f.op.id)
 assert.equal(unknown.phase,'waiting');assert.ok(unknown.commitBody)
 f.advance();await f.executor.sync(f.pack,f.op.id)
 const result=await f.store.operation(f.pack,f.op.id)
 assert.equal(result.phase,'done');assert.equal(result.issueId,'i1')
 const uploads=f.calls.filter(c=>c.path.includes('/media?'))
 assert.equal(uploads.length,2);assert.equal(uploads[0].options.idempotencyKey,uploads[1].options.idempotencyKey)
 const commits=f.calls.filter(c=>c.path.endsWith('/issues'))
 assert.equal(commits.length,2);assert.deepEqual(commits[0],commits[1])
 assert.equal((await f.store.list(f.pack)).length,1)
 assert.deepEqual(f.effects(),[1,1])
 await f.vault.close()
})

test('reopening SQLite after commit-response loss restores uploaded IDs and exact frozen body',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zt-replay-')),path=join(dir,'local.db')
 try {
  const f=await fixture(path)
  await f.executor.sync(f.pack,f.op.id);f.advance();await f.executor.sync(f.pack,f.op.id)
  const before=await f.store.operation(f.pack,f.op.id);assert.equal(before.uploaded.length,1)
  await f.vault.close()
  const {OfflineVault}=native('core/offline/OfflineVault.ets'),{OutboxStore}=native('core/offline/queue/OutboxStore.ets'),{OutboxExecutor}=native('core/offline/queue/OutboxExecutor.ets')
  const vault=new OfflineVault(sql(path)),store=new OutboxStore(vault)
  const executor=new OutboxExecutor({store,files:{read:async()=>{throw Error('must not upload again')}},access:()=>f.access,now:()=>1000000})
  await executor.sync(f.pack,f.op.id)
  const after=await store.operation(f.pack,f.op.id)
  assert.equal(after.phase,'done');assert.equal(after.commitBody,before.commitBody)
  assert.deepEqual(f.effects(),[1,1]);await vault.close()
 } finally {rmSync(dir,{recursive:true,force:true})}
})

test('epoch changes isolate, 409 conflicts stop, and connection failures obey retry limits',async()=>{
 const {ApiError}=native('core/network/ApiError.ets')
 for(const [error,phase] of [[new ApiError('EPOCH_CHANGED','复位'),'isolated'],[new ApiError('CONFLICT','冲突',409),'conflict']]) {
  const f=await fixture();f.access.client.send=async()=>{throw error}
  await f.executor.sync(f.pack,f.op.id)
  assert.equal((await f.store.operation(f.pack,f.op.id)).phase,phase);assert.equal(f.calls.length,0)
  await f.vault.close()
 }
 const f=await fixture();let calls=0
 f.access.client.send=async()=>{calls++;throw Error('network down')}
 for(let i=0;i<8;i++){await f.executor.sync(f.pack,f.op.id);f.advance()}
 assert.equal(calls,5);assert.equal((await f.store.operation(f.pack,f.op.id)).attempts,5)
 await f.vault.close()
})

test('different identity cannot submit an old queue and scope revocation blocks before upload',async()=>{
 const f=await fixture();f.access.user={...f.user,id:'other'}
 await f.executor.sync(f.pack,f.op.id)
 assert.equal(f.calls.length,0)
 f.access.user=f.user;f.workspace.points[0].status='archived'
 await f.executor.sync(f.pack,f.op.id)
 assert.equal(f.calls.length,0)
 assert.equal((await f.store.operation(f.pack,f.op.id)).phase,'blocked')
 await f.vault.close()
})

test('preflight failure does not claim a sent result and damaged local media stops without upload',async()=>{
 const f=await fixture(),original=f.access.client.send
 f.access.client.send=async()=>{throw Error('offline before upload')}
 await f.executor.sync(f.pack,f.op.id)
 assert.doesNotMatch((await f.store.operation(f.pack,f.op.id)).message,/结果待核验|可能已保存/)
 f.access.client.send=original;f.advance()
 const {OutboxExecutor}=native('core/offline/queue/OutboxExecutor.ets'),{ApiError}=native('core/network/ApiError.ets')
 const executor=new OutboxExecutor({store:f.store,access:()=>f.access,now:()=>1000000,
  files:{read:async()=>{throw new ApiError('PHOTO_INTEGRITY','照片完整性检查失败')}}})
 await executor.sync(f.pack,f.op.id)
 assert.equal((await f.store.operation(f.pack,f.op.id)).phase,'failed')
 assert.equal(f.calls.length,0);await f.vault.close()
})

test('confirmed receipts update the live view; a view callback error cannot undo durable completion',async()=>{
 const f=await fixture();f.noLoss();const results=[]
 const {OutboxExecutor}=native('core/offline/queue/OutboxExecutor.ets')
 const executor=new OutboxExecutor({store:f.store,files:{read:async()=>bytes},access:()=>f.access,
  onResult:result=>{results.push(result);throw Error('view disappeared')}})
 await executor.sync(f.pack,f.op.id)
 assert.equal(results[0]?.issue.id,'i1')
 assert.equal((await f.store.operation(f.pack,f.op.id)).phase,'done')
 await f.vault.close()
})

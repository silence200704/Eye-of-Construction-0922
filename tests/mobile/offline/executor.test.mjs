import { test } from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../nativeLoader.mjs'
import { queueFixture } from './queue-fixture.mjs'
const bytes=new Uint8Array([1,2,3]).buffer,sha='a'.repeat(64)

async function fixture() {
 const f=await queueFixture();let draft=await f.store.create(f.pack,'p')
 draft.anomalyType='模拟异常';draft.description='比赛模拟：离线独立上报。'
 draft.photos=[{draftId:'photo1',path:'private/photo1.jpg',uri:'file://private/photo1.jpg',fileName:'photo1.jpg',mimeType:'image/jpeg',source:'album',size:3,sha256:sha}]
 await f.store.save(f.pack,draft);const op=await f.store.enqueue(f.pack,draft.id)
 const calls=[];let failUpload=true,failCommit=true,commits=0,clock=0
 const access={baseUrl:f.pack.baseUrl,user:f.user,workspace:f.workspace,client:{send:async(path,options)=>{
  if(path==='/auth/me')return {data:f.user,meta:{datasetEpoch:1}}
  if(path.endsWith('/archive'))return {data:f.workspace,meta:{datasetEpoch:1}}
  calls.push({path,options})
  if(path.includes('/media?')){if(failUpload){failUpload=false;throw Error('upload response lost')}return {data:{id:'m1',size:3,sha256:sha},meta:{datasetEpoch:1}}}
  commits++;if(failCommit){failCommit=false;throw Error('commit response lost')}
  return {data:{issue:{id:'i1',issueNo:'ISS1',pointId:'p',buildingId:'b',status:'pending_review',rev:1,photos:['a1']}},meta:{datasetEpoch:1}}
 }}}
 const {OutboxExecutor}=native('core/offline/queue/OutboxExecutor.ets')
 const executor=new OutboxExecutor({store:f.store,files:{read:async()=>bytes},access:()=>access,now:()=>clock})
 return {...f,op,executor,calls,access,advance:()=>clock+=100000,commits:()=>commits}
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

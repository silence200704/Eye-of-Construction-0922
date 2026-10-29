import {test} from 'node:test'
import assert from 'node:assert/strict'
import {native} from '../nativeLoader.mjs'
import {handlingFixture} from '../handling/fixture.mjs'
import {deferred} from '../fixture.mjs'
const {PhotoReader}=native('core/media/PhotoReader.ets')

test('submitted photo is authorized before and after download and only a sandbox URI reaches the UI',async()=>{
 const f=handlingFixture(),writes=[],removed=[]
 f.intercept(path=>path.endsWith('/attachments')?{data:[{id:'a',workOrderId:'o',issueId:null,mediaId:'m',size:3,kind:'after'}],meta:{datasetEpoch:1}}:undefined)
 f.access.client.readBinary=async()=>new Uint8Array([1,2,3]).buffer
 const reader=new PhotoReader({access:()=>f.access,files:{write:b=>{writes.push(b);return 'file://private/a.jpg'},remove:u=>removed.push(u)}})
 const result=await reader.open({attachmentId:'a',orderId:'o'})
 assert.equal(result.uri,'file://private/a.jpg');assert.equal(result.kind,'after')
 assert.equal('bytes' in result,false);reader.clear();assert.deepEqual(removed,['file://private/a.jpg'])
})

test('late protected bytes after a view closes are discarded and never written to the sandbox',async()=>{
 const f=handlingFixture(),held=deferred(),writes=[]
 f.intercept(path=>path.endsWith('/attachments')?{data:[{id:'a',workOrderId:'o',mediaId:'m',size:3}],meta:{datasetEpoch:1}}:undefined)
 f.access.client.readBinary=()=>held.promise
 const reader=new PhotoReader({access:()=>f.access,files:{write:b=>{writes.push(b);return 'private'},remove:()=>{}}})
 const pending=reader.open({attachmentId:'a',orderId:'o'});await new Promise(r=>setImmediate(r));reader.clear()
 held.resolve(new Uint8Array([1,2,3]).buffer)
 await assert.rejects(pending);assert.equal(writes.length,0)
})

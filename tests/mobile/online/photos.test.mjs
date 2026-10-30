import {test} from 'node:test'
import assert from 'node:assert/strict'
import {native} from '../nativeLoader.mjs'
import {handlingFixture} from '../handling/fixture.mjs'
import {deferred} from '../fixture.mjs'
const {PhotoReader}=native('core/media/PhotoReader.ets')
const {ApiError}=native('core/network/ApiError.ets')

test('photo failures explain permission changes without exposing internal errors or mislabeling cancellation',()=>{
 const {photoErrorMessage}=native('core/media/PhotoReader.ets')
 assert.match(photoErrorMessage(new ApiError('AUTHORIZATION_CHANGED','上报位置已归档')),/权限已变化，照片未打开/)
 assert.match(photoErrorMessage(new ApiError('MEDIA_UNAVAILABLE','Forbidden',403)),/权限已变化/)
 assert.match(photoErrorMessage(new ApiError('CANCELLED','当前上报已失效')),/读取已取消/)
 assert.match(photoErrorMessage(new ApiError('EPOCH_CHANGED','旧数据')),/数据已更新/)
 assert.doesNotMatch(photoErrorMessage(Error('/private/cache File exists')),/private|File exists/)
})

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

test('archiving a point while bytes are held refuses the old image before any cache write',async()=>{
 const f=handlingFixture(),held=deferred(),writes=[]
 f.intercept(path=>path.endsWith('/attachments')?{data:[{id:'a',workOrderId:'o',mediaId:'m',size:3}],meta:{datasetEpoch:1}}:undefined)
 f.access.client.readBinary=()=>held.promise
 const reader=new PhotoReader({access:()=>f.access,files:{write:b=>{writes.push(b);return 'private'},remove:()=>{}}})
 const pending=reader.open({attachmentId:'a',orderId:'o'})
 await new Promise(r=>setImmediate(r));f.workspace.points[0].status='archived'
 held.resolve(new Uint8Array([1,2,3]).buffer)
 await assert.rejects(pending,error=>error.code==='AUTHORIZATION_CHANGED')
 assert.equal(writes.length,0)
})

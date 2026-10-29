import assert from 'node:assert/strict'
import {test} from 'node:test'
import {handlingFixture} from './fixture.mjs'
import {deferred,ApiError} from '../fixture.mjs'

test('supplement context opens the existing issue, fixed location and revision; original body stays immutable',async()=>{
 const f=handlingFixture('inspector')
 assert.equal(await f.session.startHandling({issueId:'i'}),true)
 assert.equal(f.current().draft.target.expectedRev,2)
 assert.equal(f.current().draft.description,'不可覆盖的原始记录')
 f.session.field('note','补充现场观察和位置，原始描述完整保留')
 await f.session.submit()
 const call=f.calls.find(c=>c.path.endsWith('/supplements'))
 assert.ok(call);assert.equal(JSON.parse(call.options.body).description,undefined)
 assert.equal(f.current().phase,'done')
})

test('assigned repair accepts with one command and submits measures using the server identity',async()=>{
 const f=handlingFixture()
 assert.equal(await f.session.startHandling({orderId:'o',action:'repairing'}),true)
 await f.session.submit()
 assert.equal(f.current().order.status,'repairing')
 assert.equal(await f.session.startHandling({orderId:'o',action:'submitted'}),true)
 f.session.field('measures','复紧并更换固定件');f.session.field('materials','螺栓两枚')
 await f.session.submit()
 const body=JSON.parse(f.calls.filter(c=>c.path.endsWith('/actions')).at(-1).options.body)
 assert.equal(body.to,'submitted');assert.equal(body.assigneeId,undefined)
 assert.equal(f.current().order.status,'submitted')
})

test('unassigned repair cannot accept; property proxy must give reason; UI cannot forge acceptance photos',async()=>{
 const f=handlingFixture();f.order.assigneeId='someone-else'
 assert.equal(await f.session.startHandling({orderId:'o',action:'repairing'}),false)
 f.access.user={...f.access.user,id:'demo-property',role:'property'}
 assert.equal(await f.session.startHandling({orderId:'o',action:'repairing'}),true)
 await f.session.submit();assert.match(f.current().message,/原因/)
 f.session.field('note','原维修人员外出，物业现场代接处理');await f.session.submit()
 assert.equal(f.current().phase,'done')
})

test('unknown order response retries exact key/body',async()=>{
 const f=handlingFixture();f.order.status='repairing';f.order.acceptedById='demo-repair'
 await f.session.startHandling({orderId:'o',action:'submitted'});f.session.field('measures','已复紧检查')
 let fail=true
 f.intercept(path=>{if(path.endsWith('/actions')&&fail){fail=false;throw Error('response lost')}})
 await f.session.submit();assert.equal(f.current().phase,'unknown');await f.session.retry()
 const calls=f.calls.filter(c=>c.path.endsWith('/actions'))
 assert.deepEqual(calls[0].options,calls[1].options);assert.equal(f.current().phase,'done')
})

test('a competing Web revision retains the completion draft until the user explicitly adopts the refreshed version',async()=>{
 const f=handlingFixture();f.order.status='repairing';f.order.acceptedById='demo-repair'
 await f.session.startHandling({orderId:'o',action:'submitted'});f.session.field('measures','已填写但尚未保存的处理措施')
 f.intercept(path=>{if(path.endsWith('/actions'))throw new ApiError('REVISION_CONFLICT','工单已更新',409)})
 await f.session.submit();assert.equal(f.current().phase,'conflict');assert.equal(f.saved.length,0)
 assert.equal(f.current().draft.measures,'已填写但尚未保存的处理措施')
 f.order.rev=9;f.intercept(null);f.session.adoptRevision(9);await f.session.submit()
 const calls=f.calls.filter(c=>c.path.endsWith('/actions'))
 assert.equal(JSON.parse(calls[0].options.body).expectedRev,3)
 assert.equal(JSON.parse(calls[1].options.body).expectedRev,9)
 assert.notEqual(calls[0].options.idempotencyKey,calls[1].options.idempotencyKey)
 assert.equal(f.current().phase,'done');assert.equal(f.current().order.rev,10)
})

test('a truncated order receipt cannot become a false success or reach reactive UI state',async()=>{
 const f=handlingFixture()
 await f.session.startHandling({orderId:'o',action:'repairing'})
 f.intercept(path=>path.endsWith('/actions')?{data:{order:{id:'o'}},meta:{datasetEpoch:1}}:undefined)
 await f.session.submit()
 assert.equal(f.current().phase,'unknown');assert.equal(f.current().order,null);assert.equal(f.saved.length,0)
})

test('context response after identity reset cannot repopulate an old order form',async()=>{
 const f=handlingFixture(),held=deferred()
 f.intercept(path=>path.endsWith('/handling-context')?held.promise:undefined)
 const waiting=f.session.startHandling({orderId:'o',action:'repairing'})
 await new Promise(resolve=>setImmediate(resolve));f.session.deactivate()
 held.resolve({data:{order:f.order,buildingId:'b',existingPhotoCount:0,existingPhotoBytes:0},meta:{datasetEpoch:1}})
 await waiting;assert.equal(f.current().draft,null)
})

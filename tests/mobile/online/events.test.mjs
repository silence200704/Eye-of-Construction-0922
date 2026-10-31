import {test} from 'node:test'
import assert from 'node:assert/strict'
import {native} from '../nativeLoader.mjs'
import {deferred,identity} from '../fixture.mjs'
const {EventSession}=native('core/alerts/EventSession.ets')

function fixture(journal){
 const views=[],saved=[],calls=[];let lost=false,wait=null
 const event={id:'e',eventNo:'E-1',pointId:'p',status:'pending',level:'red',rev:2,timeline:[]}
 const access={user:identity(),baseUrl:'http://localhost:8080',workspace:{epoch:1,events:[event],
  points:[{id:'p',buildingId:'b',floorId:'f',status:'active'}],buildings:[{id:'b',status:'active'}]}}
 access.client={send:async(path,options)=>{
  calls.push({path,options});let data
  if(path==='/auth/me')data=access.user
  else if(path.endsWith('/archive'))data=access.workspace
  else{if(wait)return wait; if(lost){lost=false;throw Error('response lost')}
   data={...event,status:path.endsWith('/acknowledge')?'handling':event.status,rev:event.rev+1}}
  return {data,meta:{datasetEpoch:1}}
 }}
 const session=new EventSession({journal,access:()=>access,onChange:s=>views.push(s),onEvent:e=>saved.push(e),invalidate:()=>session.deactivate()})
 return {session,access,event,views,saved,calls,lose:()=>lost=true,hold:p=>wait=p,current:()=>views.at(-1)}
}

test('alarm acknowledgement uses explicit current revision; failed response retries the original command',async()=>{
 const f=fixture();f.lose();await f.session.submit({eventId:'e',action:'acknowledge'})
 assert.equal(f.current().phase,'unknown')
 assert.match(f.current().message,/结果待核验/)
 assert.match(f.current().message,/可能已保存/)
 assert.match(f.current().message,/原请求/)
 await f.session.retry()
 const writes=f.calls.filter(c=>c.options?.method==='POST')
 assert.deepEqual(writes[0],writes[1]);assert.equal(f.current().phase,'done')
 assert.equal(f.saved[0].status,'handling')
})

test('field observations require adequate detail, and read-only roles never send commands',async()=>{
 const f=fixture();await f.session.submit({eventId:'e',action:'field-notes',kind:'investigation',note:'太短'})
 assert.equal(f.saved.length,0);assert.match(f.current().message,/10/)
 f.access.user=identity('inspector');await f.session.submit({eventId:'e',action:'acknowledge'})
 assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,0)
})

test('late acknowledgement after identity reset cannot repopulate event state',async()=>{
 const f=fixture(),held=deferred();f.hold(held.promise)
 const pending=f.session.submit({eventId:'e',action:'acknowledge'})
 await new Promise(r=>setImmediate(r));f.session.deactivate()
 held.resolve({data:{...f.event,rev:3,status:'handling'},meta:{datasetEpoch:1}})
 await pending;assert.equal(f.saved.length,0)
})

test('field note succeeds without acknowledging the event and a closed event refuses further changes',async()=>{
 const f=fixture();await f.session.submit({eventId:'e',action:'field-notes',kind:'measures',note:'模拟处置措施：已设置现场提示并安排复查跟进。'})
 assert.equal(f.saved[0].status,'pending');assert.equal(f.current().phase,'done')
 f.event.status='closed';await f.session.submit({eventId:'e',action:'acknowledge'})
 assert.equal(f.current().phase,'error');assert.equal(f.saved.length,1)
})

test('a close response with an unchanged recovering status cannot claim that closure succeeded',async()=>{
 const f=fixture();f.event.status='recovering'
 await f.session.submit({eventId:'e',action:'close',basis:'核对三次模拟恢复复测',noRepairNote:'现场核查确认无需维修，安排持续观察。'})
 assert.equal(f.current().phase,'unknown');assert.equal(f.saved.length,0)
 assert.match(f.current().message,/结果待核验/)
})

test('authorization preflight connection failure does not claim the command may have been saved',async()=>{
 const f=fixture()
 f.access.client.send=async()=>{throw Error('connection lost before POST')}
 await f.session.submit({eventId:'e',action:'acknowledge'})
 assert.equal(f.current().phase,'error')
 assert.doesNotMatch(f.current().message,/可能已保存|结果待核验/)
 assert.equal(f.saved.length,0)
})

test('feedback stays bound to its event and action instead of leaking a previous success into a new form',async()=>{
 const f=fixture();await f.session.submit({eventId:'e',action:'acknowledge'})
 assert.match(f.current().messageFor('e','acknowledge'),/保存/)
 assert.equal(f.current().messageFor('e','field-notes'),'')
 assert.equal(f.current().messageFor('other','acknowledge'),'')
 await f.session.submit({eventId:'e',action:'field-notes',kind:'investigation',note:'短句'})
 assert.match(f.current().messageFor('e','field-notes'),/10/)
 assert.equal(f.current().messageFor('e','close'),'')
})


test('alarm unknown receipt survives a new session with the same frozen key',async()=>{
 let stored;const journal={load:async()=>stored,save:async(row)=>{stored=structuredClone(row)}}
 const first=fixture(journal);first.lose();await first.session.submit({eventId:'e',action:'acknowledge'})
 assert.equal(stored?.phase,'unknown')
 const second=fixture(journal);await second.session.restore();await second.session.retry()
 assert.equal(second.calls.find(c=>c.options?.method==='POST').options.idempotencyKey,stored.key)
 assert.equal(stored.phase,'done')
})

import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fixture,deferred} from '../fixture.mjs'

test('controller merges order-only command and keeps latest revision without removing issues',async()=>{
 const f=fixture();await f.controller.connect('http://localhost:8080','demo-repair')
 const order={id:'o',rev:2,status:'assigned'}
 f.current().workspace.orders.push(order)
 f.controller.acceptReport({order:{...order,rev:3,status:'repairing'}})
 assert.equal(f.current().workspace.orders[0].status,'repairing')
 f.controller.acceptReport({order:{...order,rev:1,status:'created'}})
 assert.equal(f.current().workspace.orders[0].rev,3)
})

test('handling reload after an in-flight scope change clears all protected rows',async()=>{
 const f=fixture();await f.controller.connect('http://localhost:8080','demo-repair')
 const held=deferred()
 f.server.intercept=call=>call.path.endsWith('/work-orders')?held.promise:undefined
 const loading=f.controller.reloadHandling();await new Promise(resolve=>setImmediate(resolve))
 f.server.principal={...f.current().user,buildingIds:[]}
 held.resolve({data:[{id:'should-not-leak'}],meta:{datasetEpoch:1}})
 await loading
 assert.equal(f.current().mode,'error');assert.equal(f.current().workspace.orders.length,0)
})

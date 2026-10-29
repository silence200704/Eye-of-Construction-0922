import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fixture,deferred} from '../fixture.mjs'

test('statistics response arriving after identity switch cannot reach the page',async()=>{
 const f=fixture();await f.controller.connect('http://localhost:8080')
 const held=deferred()
 f.server.intercept=c=>c.path.includes('/mobile/insights')?held.promise:undefined
 const pending=f.controller.readInsights({period:'week',buildingId:''})
 await new Promise(r=>setImmediate(r));await f.controller.select('demo-repair')
 held.resolve({data:{period:'week',trend:[]},meta:{datasetEpoch:1}})
 assert.equal(await pending,null)
})

test('incomplete statistics never masquerade as a zero chart',async()=>{
 const f=fixture();await f.controller.connect('http://localhost:8080')
 f.server.intercept=c=>c.path.includes('/mobile/insights')?{data:{period:'week',trend:[]},meta:{datasetEpoch:1}}:undefined
 await assert.rejects(f.controller.readInsights({period:'week',buildingId:''}),error=>error.code==='INVALID_RESPONSE')
})

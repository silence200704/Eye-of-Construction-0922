import {test} from 'node:test'
import assert from 'node:assert/strict'
import {native} from '../nativeLoader.mjs'
const {filterPoints,filterTasks,deviceSummary,filterEvents}=native('core/monitoring/Selectors.ets')

test('building floor and type filters intersect, and unknown device metadata stays unknown',()=>{
 const points=[{id:'a',status:'active',buildingId:'b',floorId:'f',type:'tilt'},
   {id:'b',status:'active',buildingId:'b2',floorId:'f2',type:'crack'},
   {id:'c',status:'archived',buildingId:'b',floorId:'f',type:'tilt'}]
 assert.deepEqual(filterPoints(points,{buildingId:'b',floorId:'f',type:'tilt'}).map(p=>p.id),['a'])
 assert.match(deviceSummary({health:'online'}),/未知/)
 assert.match(deviceSummary({telemetry:{source:'simulation',connection:'offline',batteryPercent:0,lastReportAt:null}}),/0%/)
 assert.match(deviceSummary({telemetry:{source:'simulation',connection:'offline',batteryPercent:12,lastReportAt:null}}),/低电量/)
})

test('history includes archived measurement points while current monitoring stays active-only',()=>{
 const workspace={points:[{id:'old',buildingId:'b',floorId:'f',type:'crack',status:'archived'}],
 events:[{id:'history',pointId:'old',status:'closed'}]}
 assert.equal(filterEvents(workspace,{buildingId:'b',floorId:'f',type:'crack'},true).length,1)
 assert.equal(filterEvents(workspace,{buildingId:'b',floorId:'f',type:'crack'},false).length,0)
})

test('task date uses Shanghai calendar day and status and type are combined',()=>{
 const tasks=[{id:'a',status:'pending',plannedAt:'2026-10-28T20:00:00Z',planSnapshot:{kind:'patrol'}},
 {id:'b',status:'checked',plannedAt:'2026-10-29T01:00:00Z',planSnapshot:{kind:'inspection'}}]
 assert.deepEqual(filterTasks(tasks,{date:'2026-10-29',status:'pending',kind:'patrol'}).map(t=>t.id),['a'])
})

test('calendar validation rejects impossible dates and handles century leap years',()=>{
 const {validTaskDate}=native('core/monitoring/Selectors.ets')
 for(const date of ['', '2024-02-29', '2000-02-29', '2026-10-29']) assert.equal(validTaskDate(date),true,date)
 for(const date of ['2026-02-29','1900-02-29','2026-04-31','2026-13-01','2026-00-10','2026-01-00','2026-1-01','0000-01-01']) {
   assert.equal(validTaskDate(date),false,date)
 }
})

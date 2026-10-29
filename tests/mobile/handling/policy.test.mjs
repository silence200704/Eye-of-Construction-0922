import assert from 'node:assert/strict'
import {test} from 'node:test'
import {native} from '../nativeLoader.mjs'
const {orderAllowed}=native('core/field/OrderPolicy.ets')

test('a property proxy who actually accepted remains the sole completion owner',()=>{
 const order={status:'repairing',assigneeId:'demo-repair',acceptedById:'demo-property'}
 assert.equal(orderAllowed(order,{id:'demo-repair',role:'repair'},'submitted'),false)
 assert.equal(orderAllowed(order,{id:'demo-property',role:'property'},'submitted'),true)
 assert.equal(orderAllowed(order,{id:'demo-property',role:'inspector'},'submitted'),false)
 assert.equal(orderAllowed(order,{id:'demo-safety',role:'safety'},'submitted'),false)
})

test('verified work is read only and an absent identity never exposes a handling action',()=>{
 const order={status:'verified',assigneeId:'demo-repair',acceptedById:'demo-repair'}
 assert.equal(orderAllowed(order,{id:'demo-repair',role:'repair'},'repairing'),false)
 assert.equal(orderAllowed(order,{id:'demo-repair',role:'repair'},'submitted'),false)
 assert.equal(orderAllowed({...order,status:'returned'},null,'repairing'),false)
})

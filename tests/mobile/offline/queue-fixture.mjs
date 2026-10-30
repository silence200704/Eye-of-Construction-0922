import { DatabaseSync } from 'node:sqlite'
import { native } from '../nativeLoader.mjs'
import { identity } from '../fixture.mjs'
export function sql(path=':memory:') {
 const db=new DatabaseSync(path)
 return {execute:async(query,args=[])=>{db.prepare(query).run(...args)},
  read:async(query,args=[])=>db.prepare(query).all(...args).map(row=>row.body),close:async()=>db.close()}
}
export async function queueFixture(path) {
 const {OfflineVault}=native('core/offline/OfflineVault.ets')
 const {OutboxStore}=native('core/offline/queue/OutboxStore.ets')
 const vault=new OfflineVault(sql(path)),user=identity('inspector')
 const workspace={epoch:1,buildings:[{id:'b',status:'active'}],floors:[{id:'f',buildingId:'b',status:'active'}],points:[{id:'p',buildingId:'b',floorId:'f',status:'active'}],devices:[],records:[],events:[],tasks:[],issues:[],orders:[],supplementableIds:[]}
 const pack=await vault.download({baseUrl:'http://localhost:8080',user,workspace})
 const store=new OutboxStore(vault)
 return {vault,pack,store,user,workspace}
}

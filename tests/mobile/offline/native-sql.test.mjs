import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { native,nativeModules } from '../nativeLoader.mjs'

test('native RDB adapter binds values, closes result sets even on decode failure and closes its store',async()=>{
 const db=new DatabaseSync(':memory:');let closed=0,fail=false,storeClosed=false
 nativeModules.set('@ohos.data.relationalStore',{
  SecurityLevel:{S1:1},getRdbStore:async(context,config)=>{
   assert.equal(config.name,'zhutong_offline.db');assert.equal(config.securityLevel,1)
   return {
    executeSql:async(sql,args)=>{db.prepare(sql).run(...args)},
    querySql:async(sql,args)=>{
     const rows=db.prepare(sql).all(...args);let index=-1
     return {goToNextRow:()=>++index<rows.length,getColumnIndex:()=>0,
      getString:()=>{if(fail)throw Error('decode failed');return rows[index].body},close:()=>closed++}
    },close:async()=>{storeClosed=true;db.close()}
   }
  }
 })
 const {NativeLocalSql}=native('core/offline/NativeLocalSql.ets'),driver=new NativeLocalSql({})
 await driver.execute('CREATE TABLE sample (body TEXT)',[])
 await driver.execute('INSERT INTO sample VALUES (?)',["笔记 ' 不拼接SQL"])
 assert.deepEqual(await driver.read('SELECT body FROM sample',[]),["笔记 ' 不拼接SQL"])
 fail=true;await assert.rejects(driver.read('SELECT body FROM sample',[]),/decode/)
 assert.equal(closed,2);await driver.close();assert.equal(storeClosed,true)
})

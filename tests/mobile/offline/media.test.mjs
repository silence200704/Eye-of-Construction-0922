import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {native,nativeModules} from '../nativeLoader.mjs'

nativeModules.set('@ohos.file.fs',{
 OpenMode:{READ_ONLY:1,CREATE:2,READ_WRITE:4,TRUNC:8},accessSync:fs.existsSync,
 mkdirSync:path=>fs.mkdirSync(path),openSync:(path,mode)=>({fd:fs.openSync(path,mode===1?'r':'w+')}),
 closeSync:file=>fs.closeSync(file.fd),writeSync:(fd,bytes)=>fs.writeSync(fd,Buffer.from(bytes)),
 readSync:(fd,bytes)=>fs.readSync(fd,Buffer.from(bytes)),statSync:fs.statSync,renameSync:fs.renameSync,unlinkSync:fs.unlinkSync,
})
nativeModules.set('@ohos.file.fileuri',{getUriFromPath:path=>`file://${path}`})
nativeModules.set('@ohos.security.cryptoFramework',{createMd:()=>{
 const hash=createHash('sha256');return {update:async blob=>hash.update(blob.data),digest:async()=>({data:new Uint8Array(hash.digest())})}
}})

test('photo bytes survive cache removal and reopen; tampering and arbitrary file paths are rejected',async()=>{
 const {NativeDurableFiles}=native('core/offline/media/NativeDurableFiles.ets')
 const folder=fs.mkdtempSync(join(tmpdir(),'zt-media-'))
 try {
  const bytes=new Uint8Array([1,2,3]).buffer,files=new NativeDurableFiles(folder)
  const input={draftId:'report-photo-1',bytes,mimeType:'image/jpeg',source:'album'}
  const photo=await files.save(input)
  assert.equal(photo.size,3);assert.equal(photo.sha256,createHash('sha256').update(Buffer.from(bytes)).digest('hex'))
  assert.deepEqual(new Uint8Array(await new NativeDurableFiles(folder).read(photo)),new Uint8Array(bytes))
  assert.equal((await files.save(input)).path,photo.path)
  await assert.rejects(files.save({...input,bytes:new Uint8Array([4]).buffer}),/冲突/)
  await assert.rejects(files.read({...photo,path:join(folder,'..','other.jpg')}),/路径/)
  fs.writeFileSync(photo.path,new Uint8Array([9,8,7]))
  await assert.rejects(files.read(photo),/完整性/)
  await assert.rejects(files.save({...input,draftId:'../bad'}),/标识/)
  await assert.rejects(files.save({...input,draftId:'huge',bytes:new ArrayBuffer(200*1024+1)}),/200/)
 } finally {fs.rmSync(folder,{recursive:true,force:true})}
})

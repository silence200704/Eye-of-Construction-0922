import assert from 'node:assert/strict'
import {test} from 'node:test'
import {native} from '../nativeLoader.mjs'
const {ReportDraft}=native('core/report/ReportDraft.ets')
const target={pointId:'p',buildingId:'b',floorId:'f',taskId:'',expectedRev:7}
const photo=()=>({draftId:'new-photo',bytes:new ArrayBuffer(100),uri:'file://new',fileName:'new.jpg',mimeType:'image/jpeg',source:'album'})

test('supplements append note and photos to existing issue without rewriting original description',()=>{
 const draft=new ReportDraft({...target,issueId:'i1',requirePhoto:true,existingPhotoCount:1,existingPhotoBytes:100})
 draft.note='补充现场位置和另一个角度的照片'
 assert.match(draft.validateText(),/照片/)
 draft.add(photo());draft.photos[0].mediaId='media-new'
 assert.equal(draft.validate(),'')
 const body=JSON.parse(draft.body())
 assert.equal(body.expectedRev,7);assert.equal(body.description,undefined);assert.equal(body.submissionId,undefined)
 assert.equal(body.note,draft.note);assert.equal(body.photos.length,1)
 assert.throws(()=>{draft.add({...photo(),draftId:'third'});draft.add({...photo(),draftId:'fourth'})},/3|三/)
})

test('order submission requires measures and cannot forge acceptance evidence or assignment',()=>{
 const draft=new ReportDraft({...target,orderId:'wo',action:'submitted'})
 assert.match(draft.validateText(),/措施/)
 draft.measures='更换松动固定件并复紧';draft.materials='螺栓2个';draft.note='模拟验收现场记录'
 draft.add(photo());draft.photos[0].mediaId='m'
 const body=JSON.parse(draft.body())
 assert.equal(body.to,'submitted');assert.equal(body.measures,draft.measures)
 assert.equal(body.photos[0].kind,'after');assert.equal(body.assigneeId,undefined)
 draft.photos[0].kind='before';assert.equal(JSON.parse(draft.body()).photos[0].kind,'before')
})

test('property proxy acceptance requires a reason and existing attachments share the same quota',()=>{
 const draft=new ReportDraft({...target,orderId:'wo',action:'repairing',requireNote:true,existingPhotoCount:3,existingPhotoBytes:100})
 assert.match(draft.validateText(),/原因/)
 draft.note='原维修人外出，物业值班现场代接'
 assert.equal(draft.validateText(),'');assert.throws(()=>draft.add(photo()),/3|三/)
 const copy=draft.copy();assert.equal(copy.note,draft.note);assert.equal(copy.target.orderId,'wo')
})

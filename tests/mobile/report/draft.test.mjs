import assert from 'node:assert/strict'
import { test } from 'node:test'
import { native } from '../nativeLoader.mjs'
const { ReportDraft } = native('core/report/ReportDraft.ets')
const target = { pointId: 'p1', buildingId: 'b1', floorId: 'f1', taskId: '', expectedRev: 0 }
const photo = (id, size = 128) => ({ draftId: id, bytes: new ArrayBuffer(size), uri: `file://${id}`, fileName: `${id}.jpg`, mimeType: 'image/jpeg', source: 'album' })

test('report requires a real target and description, no synthetic normal or event binding', () => {
  const draft = new ReportDraft(target)
  assert.match(draft.validate(), /类型|描述/)
  draft.anomalyType = '墙面异常'; draft.description = '走廊墙面发现疑似裂缝，需要进一步核查'
  assert.equal(draft.validate(), '')
  const body = JSON.parse(draft.body())
  assert.equal(body.source, 'report'); assert.equal(body.pointId, 'p1')
  assert.equal(body.eventId, undefined); assert.ok(body.submissionId)
  assert.equal(JSON.parse(draft.body()).submissionId, body.submissionId)
})

test('three photos and 600 KB are enforced before sending, upload is not attachment success', () => {
  const draft = new ReportDraft(target)
  draft.add(photo('a', 200 * 1024)); draft.add(photo('b', 200 * 1024)); draft.add(photo('c', 200 * 1024))
  assert.throws(() => draft.add(photo('d')), /3|三/)
  assert.match(draft.validate(), /上传/)
  const second = new ReportDraft(target)
  assert.throws(() => second.add(photo('huge', 600 * 1024 + 1)), /600/)
})

test('task origin uses its original revision; photo ownership ids stay stable', () => {
  const draft = new ReportDraft({ ...target, taskId: 't1', expectedRev: 7 })
  draft.anomalyType = '设备异常'; draft.description = '设备外壳损坏，已记录现场情况'
  draft.add(photo('a')); draft.photos[0].mediaId = 'server-media'
  const body = JSON.parse(draft.body())
  assert.equal(body.expectedRev, 7); assert.equal(body.source, undefined)
  assert.deepEqual(body.photos, [{ mediaId: 'server-media', draftId: 'a', kind: 'scene' }])
  const copy = draft.copy(); copy.description = 'changed'; copy.photos[0].mediaId = 'changed'
  assert.equal(draft.photos[0].mediaId, 'server-media'); assert.notEqual(copy.description, draft.description)
})

test('empty location, missing fields, duplicate photo and oversized image cannot become a report', () => {
 const draft = new ReportDraft({ ...target, buildingId: '' })
 assert.match(draft.validate(), /位置|楼栋|测点/)
 draft.target.buildingId = 'b1'; assert.match(draft.validate(), /类型|描述/)
 draft.add(photo('same')); assert.throws(() => draft.add(photo('same')), /重复/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { native } from '../nativeLoader.mjs'
import { deferred, identity } from '../fixture.mjs'
const { ReportSession } = native('core/report/ReportSession.ets')
const target = { pointId: 'p1', buildingId: 'b1', floorId: 'f1', taskId: '', expectedRev: 0 }
const photo = () => ({ draftId: 'photo-stable', bytes: new Uint8Array([1,2,3]).buffer, uri: 'file://preview', fileName: 'photo.jpg', mimeType: 'image/jpeg', source: 'album' })
function setup() {
  const calls = [], views = [], disposed = []
  let intercept = null
  const access = { baseUrl: 'http://localhost:8080', user: identity('inspector'), workspace: { epoch: 1, tasks: [], buildings: [{ id: 'b1', status: 'active' }], points: [{ id: 'p1', buildingId: 'b1', floorId: 'f1', status: 'active' }] } }
  access.client = { send: async (path, options) => {
    calls.push({path, options})
    if (intercept) { const response = intercept(path, options); if (response !== undefined) return response }
    const data = path === '/auth/me' ? access.user : path.endsWith('/archive') ? access.workspace : path.includes('/media?') ? { id: 'media1', size: 3, sha256: 'a'.repeat(64) } : { issue: { id: 'issue1', issueNo: 'IS-1', pointId: 'p1', submissionId: '', photos: ['att1'] } }
    return { ok: true, data, meta: { datasetEpoch: 1 } }
  }, cancel() {} }
  const session = new ReportSession({ access: () => access, onChange: value => views.push(value), invalidate: message => { throw Error(message) }, disposePhoto: value => disposed.push(value.uri) })
  session.start(target); session.field('anomalyType', '墙面异常'); session.field('description', '走廊墙面发现异常，需要专业人员现场确认')
  return { session, access, calls, views, disposed, intercept: value => { intercept = value }, current: () => views.at(-1) }
}

test('picker lifecycle retains text and marks external activity until safe result is reauthorized', async () => {
  const f = setup(), held = deferred()
  const selecting = f.session.choose(async () => held.promise)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.session.isExternal(), true)
  held.resolve(photo()); await selecting
  assert.equal(f.session.isExternal(), false)
  assert.equal(f.current().draft.description, '走廊墙面发现异常，需要专业人员现场确认')
  assert.equal(f.current().draft.photos.length, 1)
})

test('picker cancellation and permission failure keep the draft; scope changes discard late bytes', async () => {
  const f = setup()
  await f.session.choose(async () => null)
  assert.equal(f.current().draft.photos.length, 0)
  await f.session.choose(async () => { throw Error('permission denied') })
  assert.match(f.current().message, /权限|取消|permission/)
  const held = deferred(), waiting = f.session.choose(async () => held.promise)
  await new Promise(resolve => setImmediate(resolve)); f.session.deactivate()
  held.resolve(photo()); await waiting
  assert.equal(f.current().draft, null); assert.deepEqual(f.disposed, ['file://preview'])
})

test('upload then issue commit uses raw bytes and stable ids; repeated taps create one issue', async () => {
  const f = setup(); await f.session.choose(async () => photo())
  const held = deferred(); f.intercept((path) => path.endsWith('/issues') ? held.promise : undefined)
  const first = f.session.submit()
  await new Promise(resolve => setImmediate(resolve)); await f.session.submit()
  assert.equal(f.calls.filter(c => c.path.includes('/media?')).length, 1)
  const upload = f.calls.find(c => c.path.includes('/media?'))
  assert.ok(upload.options.body instanceof ArrayBuffer); assert.equal(upload.options.contentType, 'image/jpeg')
  const command = f.calls.find(c => c.path.endsWith('/issues'))
  assert.equal(JSON.parse(command.options.body).photos[0].mediaId, 'media1')
  held.resolve({ data: { issue: { id: 'issue1', issueNo: 'IS-1', pointId: 'p1', photos: ['att1'] } }, meta: { datasetEpoch: 1 } }); await first
  assert.equal(f.current().phase, 'done')
})

test('committed response loss retries exactly the same issue body and key without uploading again', async () => {
  const f = setup(); await f.session.choose(async () => photo())
  let fail = true
  f.intercept(path => { if (fail && path.endsWith('/issues')) { fail = false; throw Error('lost response') } })
  await f.session.submit(); assert.equal(f.current().phase, 'unknown')
  f.session.field('description', 'must not overwrite frozen request'); await f.session.retry()
  const calls = f.calls.filter(c => c.path.endsWith('/issues'))
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].options, calls[1].options)
  assert.equal(f.calls.filter(c => c.path.includes('/media?')).length, 1)
  assert.equal(f.current().phase, 'done')
})

test('unknown media upload retries the same bytes/key and task conflict needs explicit revision adoption', async () => {
  const f = setup(); await f.session.choose(async () => photo())
  let fail = true
  f.intercept(path => { if (fail && path.includes('/media?')) { fail = false; throw Error('upload lost') } })
  await f.session.submit(); assert.equal(f.current().phase, 'upload-error')
  await f.session.submit()
  const uploads = f.calls.filter(c => c.path.includes('/media?'))
  assert.equal(uploads.length, 2); assert.deepEqual(uploads[0].options, uploads[1].options)
})

test('scope revoked while archive is in flight blocks picker result publication', async () => {
  const f = setup(); let principalCalls = 0
  const original = f.access.user
  f.intercept(path => {
    if (path === '/auth/me') {
      principalCalls++
      return { data: principalCalls > 1 ? { ...original, buildingIds: [] } : original }
    }
  })
  let selected = 0
  await assert.rejects(f.session.choose(async () => { selected++; return photo() }), /授权/)
  assert.equal(selected, 0)
  assert.equal(f.current().draft, null)
})

test('task 409 preserves uploaded evidence until explicit adoption; wrong role cannot start task report', async () => {
  const f = setup()
  f.access.workspace.tasks = [{ id: 't1', rev: 1, buildingId: 'b1', planSnapshot: { executorRole: 'inspector', pointIds: ['p1'] } }]
  f.session.deactivate()
  assert.equal(f.session.start({ ...target, taskId: 't1', expectedRev: 1 }), true)
  f.session.field('anomalyType', '裂缝'); f.session.field('description', '任务内现场异常上报')
  await f.session.choose(async () => photo())
  let conflict = true
  f.intercept(path => { if (path.endsWith('/issues') && conflict) { const e = Error('版本冲突'); e.status = 409; throw e } })
  await f.session.submit(); assert.equal(f.current().phase, 'conflict')
  assert.equal(f.current().draft.photos[0].mediaId, 'media1')
  conflict = false; f.session.adoptRevision(2); await f.session.submit()
  const commands = f.calls.filter(c => c.path.endsWith('/issues'))
  assert.equal(JSON.parse(commands[1].options.body).expectedRev, 2)
  assert.equal(f.calls.filter(c => c.path.includes('/media?')).length, 1)
  f.session.deactivate(); f.access.user = identity('property')
  assert.equal(f.session.start({ ...target, taskId: 't1', expectedRev: 2 }), false)
})

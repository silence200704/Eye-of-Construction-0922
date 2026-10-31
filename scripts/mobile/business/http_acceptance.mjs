// Isolated loopback acceptance of the actual ArkTS command builders and runners.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { native } from '../../../tests/mobile/nativeLoader.mjs'
const require = createRequire(import.meta.url)
const { BusinessDraft, businessWrite } = native('core/business/BusinessDraft.ets')
const { BusinessSession } = native('core/business/BusinessSession.ets')
const { startBusiness } = native('core/business/BusinessStart.ets')
const { BusinessStore } = native('core/business/BusinessStore.ets')
const { OfflineVault } = native('core/offline/OfflineVault.ets')
const { FieldQueue } = native('core/offline/field/FieldQueue.ets')
const { FieldExecutor } = native('core/offline/field/FieldExecutor.ets')
const { TaskCommander } = native('core/field/TaskCommander.ets')
const { CheckDraft } = native('core/field/CheckDraft.ets')
const { PhotoReader } = native('core/media/PhotoReader.ets')
const { EventSession } = native('core/alerts/EventSession.ets')
const { readWorkspace } = native('data/repositories/WorkspaceRepository.ets')
const { selectDataset, datasetPath } = native('core/network/DatasetSelection.ets')
const { scopeKey } = native('core/offline/OfflineModels.ets')
const { uploadBusinessPhotos } = native('core/business/BusinessPhotos.ets')
const { ApiError } = native('core/network/ApiError.ets')
selectDataset('demo-showcase')
const base = 'http://127.0.0.1:18016', directory = 'backend/.runtime-app-business-final'
const evidence = [], accounts = new Map()
const db = new DatabaseSync(`${directory}/native-local.sqlite`)
const vault = new OfflineVault({ execute: async (sql, values) => { db.prepare(sql).run(...values) },
  read: async (sql, values) => db.prepare(sql).all(...values).map(row => row.body), close: async () => db.close() })
const store = new BusinessStore(vault)
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
let current, sequence = 0, loseNext = false

async function account(role) {
  if (!accounts.has(role)) {
    const response = await fetch(`${base}/api/v1/demo/identity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityId: `demo-${role}` }) })
    accounts.set(role, (await response.json()).data)
  }
  const session = accounts.get(role)
  const client = { send: async (path, options = {}) => {
    const response = await fetch(`${base}/api/v1${datasetPath(path)}`, { method: options.method ?? 'GET',
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': options.contentType ?? 'application/json',
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        ...(options.datasetEpoch ? { 'X-Dataset-Epoch': String(options.datasetEpoch) } : {}) }, body: options.body })
    const data = await response.json()
    if (!response.ok) throw new ApiError(data.error.code, data.error.message, response.status)
    if (loseNext && options.method === 'POST' && path.endsWith('/issues')) { loseNext = false; throw new Error('deliberately lost after server commit') }
    return data
  }, readBinary: async path => {
    const response = await fetch(`${base}/api/v1${datasetPath(path)}`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
    assert.equal(response.status, 200); return response.arrayBuffer()
  } }
  current = { client, baseUrl: base, user: session.user, workspace: await readWorkspace({ client, isCurrent: () => true }) }
  return current
}
async function reload() { current.workspace = await readWorkspace({ client: current.client, isCurrent: () => true }) }
function state() { return { workspace: current.workspace, user: current.user, identities: [...accounts.values()].map(row => row.user) } }
async function act(draft, lost = false) {
  let status
  const session = new BusinessSession({ access: () => current, journal: store.journal(), onChange: row => { status = row }, onResult: () => {} })
  loseNext = lost
  let result = await session.submit(businessWrite(draft))
  if (lost) { assert.equal(status.phase, 'unknown'); result = await session.retry() }
  assert.equal(status.phase, 'done', status.message)
  evidence.push({ kind: draft.kind, action: draft.action, role: current.user.role, issueId: result.issue?.id, orderId: result.order?.id, phase: status.phase, lostRetry: lost })
  await reload(); return result
}
function nextDay() { return new Date(Date.now() + 86400000).toISOString().slice(0, 10) }
async function control(kind, body = {}) {
  return current.client.send(`/datasets/demo-main/showcase/${kind}`, { method: 'POST', body: JSON.stringify(body), datasetEpoch: current.workspace.epoch, idempotencyKey: `accept-control-${runId}-${++sequence}` })
}
function photo(id, kind = 'scene') {
  const encoded = require('jpeg-js').encode({ width: 2, height: 2, data: Buffer.from([90, 150, 110, 255, 90, 150, 110, 255, 90, 150, 110, 255, 90, 150, 110, 255]) }, 70).data
  const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  return { draftId: id, path: `${directory}/${id}.jpg`, uri: '', fileName: `${id}.jpg`, mimeType: 'image/jpeg', size: encoded.length,
    sha256: createHash('sha256').update(encoded).digest('hex'), source: 'album', kind, mediaId: '', bytes }
}
async function upload(photos, pointId) {
  return uploadBusinessPhotos(photos, { access: current, current: () => current, pointId,
    files: { read: async row => row.bytes }, save: async () => {} })
}
async function mainChain() {
  await account('safety'); await control('reset', { confirmDataset: 'demo-showcase' }); await reload(); await control('prepare'); await reload()
  await control('sample', { sensor: 'crack', level: 'red' }); await reload()
  const point = current.workspace.points.find(row => row.code === 'SHOW-crack'), event = current.workspace.events[0]
  assert.ok(event)
  const draft = new BusinessDraft(); draft.kind = 'report'; draft.buildingId = point.buildingId; draft.floorId = point.floorId
  draft.pointId = point.id; draft.eventId = event.id; draft.anomalyType = '比赛模拟设备松动'; draft.description = '比赛模拟现场照片与维修闭环，不代表真实隐患。'
  const issue = (await act(draft, true)).issue
  const review = JSON.parse(startBusiness(state(), 'review', issue.id)); review.note = '现场核查需要维修固定装置'
  const order = (await act(review)).order; assert.equal(order.status, 'created')
  const assign = JSON.parse(startBusiness(state(), 'order', order.id, 'assigned')); assign.assigneeId = 'demo-repair'
  await act(assign); await account('repair')
  await act(JSON.parse(startBusiness(state(), 'order', order.id, 'repairing')))
  const complete = JSON.parse(startBusiness(state(), 'order', order.id, 'submitted')); complete.measures = '模拟重新紧固并复测固定件'; complete.materials = '模拟紧固件'
  complete.photos = await upload([photo('repair-before', 'before'), photo('repair-after', 'after')], point.id); await act(complete)
  await account('safety')
  const returned = JSON.parse(startBusiness(state(), 'order', order.id, 'returned')); returned.note = '模拟验收退回：请再次核验固定效果'; await act(returned)
  await account('repair'); await act(JSON.parse(startBusiness(state(), 'order', order.id, 'repairing')))
  const again = JSON.parse(startBusiness(state(), 'order', order.id, 'submitted')); again.measures += '；已完成返工复核'; await act(again)
  await account('safety')
  const verify = JSON.parse(startBusiness(state(), 'order', order.id, 'verified')); verify.note = '模拟验收确认维修资料及现场复核齐全'
  verify.photos = await upload([photo('acceptance', 'acceptance')], point.id); await act(verify)
  assert.equal(current.workspace.issues.find(row => row.id === issue.id).status, 'pending_recheck')
  const register = JSON.parse(startBusiness(state(), 'recheck', issue.id)); register.dueDate = nextDay(); await act(register)
  const observe = JSON.parse(startBusiness(state(), 'outcome', issue.id)); observe.outcome = 'observing'; observe.note = '模拟复查继续观察固定效果'; observe.nextDueDate = nextDay(); await act(observe)
  const recovered = JSON.parse(startBusiness(state(), 'outcome', issue.id)); recovered.note = '模拟复查确认固定效果恢复'; await act(recovered)
  const events = new EventSession({ access: () => current, journal: store.journal(), onChange: () => {}, onEvent: () => {}, invalidate: text => { throw new Error(text) } })
  await events.submit({ eventId: event.id, action: 'acknowledge' }); await reload()
  await control('sample', { sensor: 'crack', level: 'normal' }); await reload()
  assert.equal(current.workspace.events.find(row => row.id === event.id).status, 'recovering')
  await events.submit({ eventId: event.id, action: 'close', basis: '模拟三次恢复复测与已验收关联维修工单均已核验' }); await reload()
  assert.equal(current.workspace.events.find(row => row.id === event.id).status, 'closed')
  const attachments = (await current.client.send('/datasets/demo-main/attachments')).data.filter(row => row.workOrderId === order.id)
  assert.equal(attachments.length, 3)
  const hashes = []
  const reader = new PhotoReader({ access: () => current, files: { write: bytes => {
    hashes.push(createHash('sha256').update(Buffer.from(bytes)).digest('hex')); return 'private-preview';
  }, remove: () => {} } })
  for (const attachment of attachments) {
    const opened = await reader.open({ attachmentId: attachment.id, orderId: order.id }); assert.equal(opened.kind, attachment.kind)
    assert.equal(hashes.at(-1), attachment.sha256)
  }
  reader.clear(); evidence.push({ originalPhotoReadback: hashes, kinds: attachments.map(row => row.kind) })
  evidence.push({ mainChain: 'closed', issueId: issue.id, orderId: order.id, eventId: event.id })
}
async function inspectionAndMaintenance() {
  await account('inspector')
  const task = current.workspace.tasks[0], pointId = task.planSnapshot.pointIds[1], point = current.workspace.points.find(row => row.id === pointId)
  const check = new CheckDraft(task, pointId); check.labelRead = point.nfc.code; check.answers[0].result = 'abnormal'; check.answers[0].note = '比赛模拟固定件异常'
  const report = new BusinessDraft(); report.kind = 'report'; report.taskId = task.id; report.pointId = pointId; report.buildingId = task.buildingId; report.rev = task.rev
  report.anomalyType = '巡检模拟异常'; report.description = '离线流程同步时依次登记到点、异常问题与完成结果。'
  const writes = [check.request('check-in', task.id, pointId), check.request('complete-point', task.id, pointId)]
  const queue = new FieldQueue(vault), scope = scopeKey(current)
  await queue.workflow({ id: `http-offline-inspection-${current.workspace.epoch}`, scope, photos: [], writes: [
    { path: `/inspection/tasks/${encodeURIComponent(task.id)}/check-in`, kind: 'task', targetId: task.id, body: writes[0].body },
    businessWrite(report), { path: `/inspection/tasks/${encodeURIComponent(task.id)}/complete-point`, kind: 'task', targetId: task.id, body: writes[1].body },
  ] })
  const executor = new FieldExecutor({ queue, access: () => current, files: { read: async () => new ArrayBuffer(0) }, onResult: () => {} })
  await executor.sync(scope)
  const rows = await queue.list(scope); assert.deepEqual(rows.map(row => row.phase), ['done', 'done', 'done'])
  await reload(); assert.equal(current.workspace.tasks[0].results.find(row => row.pointId === pointId).status, 'completed')
  await account('device'); const maintenance = current.workspace.maintenance[0]
  const draft = JSON.parse(startBusiness(state(), 'maintenance', maintenance.id)); draft.measures = '模拟检查清洁并紧固设备'; draft.nextDueDate = nextDay()
  draft.answers.forEach(row => { row.result = 'ok' }); await act(draft)
  evidence.push({ offlineWorkflow: rows.map(row => ({ id: row.id, key: row.key, phase: row.phase, requestHash: row.requestHash })), maintenanceId: maintenance.id })
}
async function discovery(role = 'inspector') {
  await account(role)
  const point = current.workspace.points[0], draft = new BusinessDraft()
  draft.kind = 'report'; draft.pointId = point.id; draft.buildingId = point.buildingId; draft.floorId = point.floorId
  draft.anomalyType = '比赛模拟分支核验'; draft.description = '独立模拟问题，用于验证审核分流与原问题补证。'
  return (await act(draft)).issue
}
async function reviewBranches() {
  const issue = await discovery(); await account('safety')
  const need = JSON.parse(startBusiness(state(), 'review', issue.id)); need.action = 'need_evidence'; need.category = 'image'; need.note = '请补充新的现场照片及位置依据'
  await act(need); await account('inspector')
  const supplement = JSON.parse(startBusiness(state(), 'supplement', issue.id)); supplement.note = '现已补充对应位置的模拟现场照片'
  supplement.photos = await upload([photo('supplement-scene')], supplement.pointId); await act(supplement)
  await account('safety')
  const investigate = JSON.parse(startBusiness(state(), 'review', issue.id)); investigate.action = 'to_investigate'; investigate.category = 'structure'; investigate.note = '模拟安排专业排查结构与固定情况'
  await act(investigate)
  const recheckIssue = await discovery(); await account('safety')
  const review = JSON.parse(startBusiness(state(), 'review', recheckIssue.id)); review.action = 'recheck'; review.category = 'remeasure'; review.note = '模拟安排现场复测'; await act(review)
  const register = JSON.parse(startBusiness(state(), 'recheck', recheckIssue.id)); register.dueDate = nextDay(); await act(register)
  const recurred = JSON.parse(startBusiness(state(), 'outcome', recheckIssue.id)); recurred.outcome = 'recurred'; recurred.note = '模拟复测发现异常复发'; await act(recurred)
  assert.equal(current.workspace.issues.find(row => row.id === recheckIssue.id).status, 'pending_review')
  const duplicate = await discovery(); await account('safety')
  const link = JSON.parse(startBusiness(state(), 'review', duplicate.id)); link.action = 'link_object'; link.category = 'issue'; link.duplicateOf = issue.id; link.note = '核查确认为同一处模拟问题'; await act(link)
  assert.equal(current.workspace.issues.find(row => row.id === duplicate.id).duplicateOf, issue.id)
  for (const category of ['no_fault', 'handled']) {
    const item = await discovery(); await account('safety')
    const close = JSON.parse(startBusiness(state(), 'review', item.id)); close.action = 'close_no_fault'; close.category = category
    close.note = '模拟现场核查已确认无需进一步维修'; close.noPhotoReason = '模拟现场条件限制无法另外取得照片'; await act(close)
    assert.equal(current.workspace.issues.find(row => row.id === item.id).status, 'closed')
  }
  const manual = new BusinessDraft(); manual.kind = 'manual'; manual.pointId = current.workspace.points[0].id; manual.title = '独立模拟维修工单'
  const order = (await act(manual)).order; assert.equal(order.issueId, null)
  evidence.push({ reviewBranches: ['need_evidence+supplement', 'to_investigate', 'recheck+recurred', 'link_object', 'close_no_fault', 'handled'], manualOrderId: order.id })
}
try {
  await mainChain(); await inspectionAndMaintenance(); await reviewBranches()
  const result = { source: 'real loopback HTTP + production ArkTS builders/runners, not simulator UI', entries: evidence, passed: true }
  mkdirSync('docs/implementation/evidence/app-business/verification', { recursive: true })
  writeFileSync('docs/implementation/evidence/app-business/verification/native-http.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ passed: true, entries: evidence.length }))
} finally { await vault.close() }

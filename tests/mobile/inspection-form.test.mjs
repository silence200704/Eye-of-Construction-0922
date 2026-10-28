import assert from 'node:assert/strict'
import { test } from 'node:test'
import { native } from './nativeLoader.mjs'

const task = { id: 'task', rev: 3, status: 'pending', buildingId: 'B1', planSnapshot: {
  executorRole: 'inspector', pointIds: ['P1', 'P2'], checklist: [
    { key: 'wall', label: '墙面', required: true }, { key: 'door', label: '门窗', required: false },
  ] }, results: [{ pointId: 'P1', status: 'arrived', checklist: [], issueIds: ['issue-P1'] },
    { pointId: 'P2', status: 'pending', checklist: [], issueIds: [] }] }

test('inspection draft is initialized from the frozen checklist and keeps unknown answers unanswered', () => {
  const { CheckDraft } = native('core/field/CheckDraft.ets')
  const form = new CheckDraft(task, 'P1')
  assert.equal(form.rev, 3)
  assert.deepEqual(form.answers.map(row => row.result), [null, null])
  assert.equal(form.validate('complete-point', task, 'P1'), '请完成全部必答检查项。')
})

test('manual arrival needs a reason, a read tag and a matching expected task revision', () => {
  const { CheckDraft } = native('core/field/CheckDraft.ets')
  const form = new CheckDraft(task, 'P2')
  form.method = 'manual'
  assert.ok(form.validate('check-in', task, 'P2').includes('标签'))
  form.labelRead = 'TAG-P2'
  assert.ok(form.validate('check-in', task, 'P2').includes('原因'))
  form.fallbackReason = '标签损坏，人工核对'
  assert.equal(form.validate('check-in', task, 'P2'), '')
  assert.ok(form.validate('check-in', { ...task, rev: 4 }, 'P2').includes('版本'))
})

test('completion requires arrival and an anomaly basis; only same-point issue ids are selectable', () => {
  const { CheckDraft } = native('core/field/CheckDraft.ets')
  const form = new CheckDraft(task, 'P1')
  form.choose('wall', 'abnormal')
  assert.ok(form.validate('complete-point', task, 'P1').includes('异常'))
  form.linkedIssueId = 'unrelated'
  assert.ok(form.validate('complete-point', task, 'P1').includes('关联'))
  form.linkedIssueId = 'issue-P1'
  assert.equal(form.validate('complete-point', task, 'P1'), '')
  form.linkedIssueId = null
  form.noIssueReason = '现场确认属于旧痕迹且已修补，不需另建问题'
  assert.equal(form.validate('complete-point', task, 'P1'), '')
  const missing = new CheckDraft(task, 'P2')
  missing.choose('wall', 'ok')
  assert.ok(missing.validate('complete-point', task, 'P2').includes('到点'))
})

test('request snapshots omit unanswered optional fields and changing a draft never mutates a frozen request', () => {
  const { CheckDraft } = native('core/field/CheckDraft.ets')
  const form = new CheckDraft(task, 'P1')
  form.choose('wall', 'ok')
  form.note('wall', '已核对')
  const request = form.request('complete-point', task.id, 'P1')
  const payload = JSON.parse(request.body)
  assert.equal(payload.expectedRev, 3)
  assert.equal(payload.answers.length, 1)
  assert.equal(payload.answers[0].result, 'ok')
  form.choose('wall', 'abnormal')
  assert.equal(JSON.parse(request.body).answers[0].result, 'ok')
  assert.deepEqual(task.results[0].checklist, [])
})

test('draft copies isolate answers and completed points cannot be resubmitted', () => {
  const { CheckDraft } = native('core/field/CheckDraft.ets')
  const form = new CheckDraft(task, 'P1'), copy = form.copy()
  copy.choose('wall', 'ok')
  assert.equal(form.answers[0].result, null)
  const done = { ...task, results: [{ ...task.results[0], status: 'completed' }] }
  assert.ok(copy.validate('complete-point', done, 'P1').includes('已完成'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { native } from '../../nativeLoader.mjs'

test('review, dispatch, acceptance and recheck produce existing API commands', () => {
  const { BusinessDraft, businessWrite } = native('core/business/BusinessDraft.ets')
  const form = new BusinessDraft()
  form.kind = 'review'; form.targetId = 'i'; form.rev = 3
  form.action = 'to_repair'; form.category = 'equipment'; form.note = '水泵故障需要维修'
  assert.equal(businessWrite(form).path, '/issues/i/review')
  assert.equal(JSON.parse(businessWrite(form).body).expectedRev, 3)
  form.kind = 'order'; form.targetId = 'w'; form.action = 'assigned'
  assert.throws(() => businessWrite(form), /维修人/)
  form.assigneeId = 'repair-id'
  assert.equal(JSON.parse(businessWrite(form).body).assigneeId, 'repair-id')
  form.action = 'returned'; form.note = ''
  assert.throws(() => businessWrite(form), /意见/)
  form.kind = 'outcome'; form.targetId = 'i'; form.outcome = 'observing'; form.note = '持续观察继续复测'
  assert.throws(() => businessWrite(form), /日期/)
  form.nextDueDate = '2026-11-04'
  assert.equal(businessWrite(form).path, '/issues/i/rechecks/outcome')
})

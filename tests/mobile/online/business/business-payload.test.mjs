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
test('mobile management validates all existing review and maintenance branches', () => {
  const { BusinessDraft, businessWrite, validDay, businessFormKey } = native('core/business/BusinessDraft.ets')
  const draft = new BusinessDraft(); draft.kind = 'review'; draft.targetId = 'i'; draft.note = '现场核查已经确认相关情况'
  for (const action of ['to_repair', 'to_investigate', 'recheck', 'need_evidence', 'close_no_fault']) {
    draft.action = action; assert.ok(businessWrite(draft).body)
  }
  draft.action = 'link_object'; draft.category = 'issue'; assert.throws(() => businessWrite(draft))
  draft.duplicateOf = 'other'; assert.match(businessWrite(draft).body, /other/)
  draft.action = 'close_no_fault'; draft.category = 'handled'; assert.throws(() => businessWrite(draft))
  draft.noPhotoReason = '现场条件限制暂时无法取得照片'; assert.ok(businessWrite(draft))
  draft.kind = 'manual'; assert.throws(() => businessWrite(draft)); draft.title = '现场维修'; assert.equal(businessWrite(draft).targetId, '')
  draft.kind = 'report'; assert.throws(() => businessWrite(draft)); draft.anomalyType = '设备异常'; draft.description = '现场检查异常'; draft.buildingId = 'b'
  assert.equal(businessWrite(draft).path, '/issues'); draft.taskId = 't'; assert.equal(businessWrite(draft).kind, 'task')
  draft.kind = 'supplement'; draft.note = ''; assert.throws(() => businessWrite(draft)); draft.note = '已补充现场位置和照片说明'; assert.ok(businessWrite(draft))
  draft.kind = 'recheck'; assert.throws(() => businessWrite(draft)); draft.subject = '复查固定件'; draft.owner = '演示人员'; draft.dueDate = '2026-11-04'; assert.ok(businessWrite(draft))
  draft.kind = 'maintenance'; assert.throws(() => businessWrite(draft)); draft.measures = '重新紧固'; draft.nextDueDate = '2026-11-05'
  draft.answers = [{ key: 'fix', result: 'abnormal', note: '', label: '固定' }]; assert.throws(() => businessWrite(draft))
  draft.answers[0].note = '模拟固定件松动'; draft.createIssue = true; assert.throws(() => businessWrite(draft))
  draft.abnormalNote = '需要维修固定件'; assert.match(businessWrite(draft).path, /maintenance/)
  assert.equal(validDay('2026-02-30'), false); assert.equal(validDay('x'), false); assert.ok(businessFormKey(draft))
})

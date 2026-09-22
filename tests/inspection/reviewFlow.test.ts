/**
 * 审核出口与工单流转测试（方案 §3）。
 * 关键口径：六种出口各有前置条件；工单验收不等于问题自动关闭；
 * 关闭预警事件需要有处置依据（验收通过的工单，或安全管理人员填写"无需维修"核查结论）。
 */
import { describe, expect, it } from 'vitest'
import { candidateDuplicates, findDuplicate, review, reviewActionLabel, reviewCategoryLabel, submissionKeyOf } from '@/core/inspection/issueMerge'
import { advance, closeBasis, isAssignedTo, issueAfterVerify } from '@/core/inspection/workOrderFlow'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const ACTOR = { by: '演示操作员', byRole: 'safety' }

function issue(override: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    ...AUDIT,
    id: 'iss_1',
    issueNo: 'ISS-20260920-001',
    source: 'inspection',
    submissionKey: 'inspection:pnt_1:探头松动:1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    eventId: null,
    taskId: 'task_1',
    anomalyType: '探头松动',
    description: '探头固定支架松动',
    photos: [],
    status: 'pending_review',
    reviewAction: null,
    reviewCategory: '',
    linkedEventId: null,
    reviewedAt: null,
    reviewedBy: '',
    reviewNote: '',
    duplicateOf: null,
    workOrderIds: [],
    timeline: [],
    ...override,
  }
}

function order(override: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...AUDIT,
    id: 'wo_1',
    orderNo: 'WO-20260920-001',
    origin: 'issue',
    issueId: 'iss_1',
    eventId: null,
    pointId: 'pnt_1',
    title: '探头松动处理',
    status: 'created',
    assignee: '',
    assignedBy: '',
    assignedAt: null,
    dueAt: null,
    measures: '',
    materials: '',
    photos: [],
    submittedAt: null,
    reviews: [],
    timeline: [],
    ...override,
  }
}

describe('提交标识与重复问题', () => {
  it('预警转单按事件编号归并：同一次预警只对应一条问题', () => {
    const a = submissionKeyOf({ source: 'sensor', pointId: 'pnt_1', buildingId: 'bld_1', anomalyType: '越限', at: AT, eventId: 'evt_1' })
    const b = submissionKeyOf({ source: 'sensor', pointId: 'pnt_1', buildingId: 'bld_1', anomalyType: '越限', at: '2026-09-20T11:00:00.000Z', eventId: 'evt_1' })
    expect(a).toBe(b)
    expect(a).toBe('event:evt_1')
  })

  it('同一位置同一异常在时间窗内算同一次提交，超出窗口算新的', () => {
    const base = { source: 'inspection' as const, pointId: 'pnt_1', buildingId: 'bld_1', anomalyType: '探头松动' }
    const first = submissionKeyOf({ ...base, at: AT, windowMinutes: 10 })
    const within = submissionKeyOf({ ...base, at: '2026-09-20T09:05:00.000Z', windowMinutes: 10 })
    const later = submissionKeyOf({ ...base, at: '2026-09-20T09:40:00.000Z', windowMinutes: 10 })
    expect(within).toBe(first)
    expect(later).not.toBe(first)
  })

  it('重复提交时能找到已存在的问题，不重复建单', () => {
    const rows = [issue(), issue({ id: 'iss_2', issueNo: 'ISS-20260920-002', submissionKey: 'other' })]
    expect(findDuplicate(rows, 'inspection:pnt_1:探头松动:1')?.id).toBe('iss_1')
    expect(findDuplicate(rows, 'nope')).toBeUndefined()
  })
})

describe('跨来源疑似重复（只提示，不静默合并）', () => {
  const inspection = issue({ id: 'iss_1', source: 'inspection', submissionKey: 'inspection:pnt_1:探头松动:1' })
  const reported = issue({
    id: 'iss_2',
    issueNo: 'ISS-20260920-002',
    source: 'report',
    submissionKey: 'report:pnt_1:探头松动:1',
    createdAt: '2026-09-20T09:20:00.000Z',
  })

  it('同一测点同一异常的巡检发现与人工上报会互相提示', () => {
    const found = candidateDuplicates([inspection], {
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      zoneId: '二层走廊',
      anomalyType: '探头松动',
      at: '2026-09-20T09:20:00.000Z',
    })
    expect(found.map((row) => row.id)).toEqual(['iss_1'])
    // 两条问题的来源、时间线各自保留，没有被合并
    expect(reported.source).toBe('report')
    expect(inspection.timeline).toEqual(reported.timeline)
  })

  it('已关闭的问题不再提示重复', () => {
    const closed = issue({ status: 'closed' })
    expect(candidateDuplicates([closed], { pointId: 'pnt_1', buildingId: 'bld_1', zoneId: '二层走廊', anomalyType: '探头松动', at: AT })).toEqual([])
  })

  it('超出时间窗或异常类型不同都不提示', () => {
    const probe = { pointId: 'pnt_1', buildingId: 'bld_1', zoneId: '二层走廊', at: AT, windowHours: 24 }
    expect(candidateDuplicates([inspection], { ...probe, anomalyType: '墙体渗水' })).toEqual([])
    expect(candidateDuplicates([inspection], { ...probe, anomalyType: '探头松动', at: '2026-09-25T09:00:00.000Z' })).toEqual([])
  })

  it('同一区域的不同点位也会提示（楼层同一位置附近）', () => {
    const other = issue({ id: 'iss_3', pointId: 'pnt_9' })
    const found = candidateDuplicates([other], { pointId: 'pnt_1', buildingId: 'bld_1', zoneId: '二层走廊', anomalyType: '探头松动', at: AT })
    expect(found.map((row) => row.id)).toEqual(['iss_3'])
  })

  it('同一次提交重试不算重复候选（提交标识相同）', () => {
    const key = 'inspection:pnt_1:探头松动:1'
    const found = candidateDuplicates([inspection], {
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      zoneId: '二层走廊',
      anomalyType: '探头松动',
      at: AT,
    }, key)
    expect(found).toEqual([])
  })
})

describe('六种审核出口', () => {
  it('设备故障转维修：进入处理中，并要求建工单', () => {
    const out = review({ issue: issue(), action: 'to_repair', category: 'equipment', note: '现场确认为支架松动，转维修', at: AT, ...ACTOR })
    expect(out.ok).toBe(true)
    expect(out.nextStatus).toBe('repairing')
    expect(out.followUp).toBe('work_order')
  })

  it('建筑问题转专业排查必须写明方向', () => {
    const denied = review({ issue: issue(), action: 'to_investigate', category: 'crack', note: '  ', at: AT, ...ACTOR })
    expect(denied.ok).toBe(false)
    expect(denied.nextStatus).toBe('pending_review')
    const ok = review({ issue: issue(), action: 'to_investigate', category: 'crack', note: '请结构专业复核墙体裂缝走向', at: AT, ...ACTOR })
    expect(ok.nextStatus).toBe('investigating')
  })

  it('证据不足退回补充要写缺什么，问题留在待审核', () => {
    const denied = review({ issue: issue(), action: 'need_evidence', category: 'image', note: '', at: AT, ...ACTOR })
    expect(denied.ok).toBe(false)
    const ok = review({ issue: issue(), action: 'need_evidence', category: 'image', note: '缺少整体环境照片，无法判断周边受影响范围', at: AT, ...ACTOR })
    expect(ok.nextStatus).toBe('pending_review')
    expect(ok.followUp).toBe('notify_reporter')
  })

  it('重复问题必须选择关联的原记录，且不能关联自己', () => {
    expect(review({ issue: issue(), action: 'link_object', category: 'issue', note: '与已有问题同源', duplicateOf: null, at: AT, ...ACTOR }).ok).toBe(false)
    expect(review({ issue: issue(), action: 'link_object', category: 'issue', note: '重复提交', duplicateOf: 'iss_1', at: AT, ...ACTOR }).ok).toBe(false)
    const ok = review({ issue: issue(), action: 'link_object', category: 'issue', note: '同一处问题', duplicateOf: 'iss_9', at: AT, ...ACTOR })
    expect(ok.ok).toBe(true)
    expect(ok.followUp).toBe('link_duplicate')
  })

  it('未发现异常而关闭必须写明依据（不少于 10 字）', () => {
    const denied = review({ issue: issue(), action: 'close_no_fault', category: 'no_fault', note: '查过了没问题', at: AT, ...ACTOR })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('依据')
    const ok = review({
      issue: issue(),
      action: 'close_no_fault',
      category: 'no_fault',
      note: '现场复查探头固定牢靠，读数正常，无异常',
      at: AT,
      ...ACTOR,
    })
    expect(ok.nextStatus).toBe('closed')
  })

  it('已关闭的问题不能再审核，需新建并关联原记录', () => {
    const closed = issue({ status: 'closed' })
    const out = review({ issue: closed, action: 'to_repair', category: 'equipment', note: '又松了', at: AT, ...ACTOR })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('已关闭')
  })

  it('情况不明安排复查：进入待复查', () => {
    const ok = review({ issue: issue(), action: 'recheck', category: 'unclear', note: '雨天无法判断，另约时间复查现场', at: AT, ...ACTOR })
    expect(ok.nextStatus).toBe('pending_recheck')
    expect(ok.followUp).toBe('recheck_task')
  })

  it('二级分类必选，且必须是该出口允许的分类', () => {
    const missing = review({ issue: issue(), action: 'to_repair', category: '', note: '转维修', at: AT, ...ACTOR })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('二级分类')
    const wrong = review({ issue: issue(), action: 'to_repair', category: 'false_alarm', note: '转维修', at: AT, ...ACTOR })
    expect(wrong.ok).toBe(false)
  })

  it('关联既有预警事件：必须选择事件，选中后可关闭', () => {
    const missing = review({ issue: issue(), action: 'link_object', category: 'event', note: '同一次预警', linkedEventId: '', at: AT, ...ACTOR })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('预警事件')
    const ok = review({ issue: issue(), action: 'link_object', category: 'event', note: '同一次预警', linkedEventId: 'evt_1', at: AT, ...ACTOR })
    expect(ok.ok).toBe(true)
    expect(ok.nextStatus).toBe('closed')
  })

  it('任一出口都要写审核意见（太短等于没留痕）', () => {
    const out = review({ issue: issue(), action: 'to_repair', category: 'general', note: '好', at: AT, ...ACTOR })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('审核意见')
  })

  it('二级分类名称可读', () => {
    expect(reviewCategoryLabel('link_object', 'event')).toBe('关联既有预警事件')
    expect(reviewCategoryLabel('close_no_fault', 'false_alarm')).toBe('误报')
    expect(reviewCategoryLabel(null, 'x')).toBe('')
  })

  it('出口名称可读', () => {
    expect(reviewActionLabel('to_repair')).toBe('转维修工单')
    expect(reviewActionLabel(null)).toBe('未审核')
  })
})

describe('工单流转', () => {
  it('按固定路径前进：派工（需指定维修人）→ 接单 → 提交 → 验收', () => {
    // 派工必须指定维修人
    expect(advance({ order: order(), to: 'assigned', at: AT, by: '安全管理员', byRole: 'safety', note: '派工' }).ok).toBe(false)

    const assigned = advance({
      order: { ...order(), assignee: '张工' },
      to: 'assigned',
      at: AT,
      by: '安全管理员',
      byRole: 'safety',
      note: '派给张工',
    })
    expect(assigned.ok).toBe(true)
    expect(assigned.next?.status).toBe('assigned')

    const repairing = advance({ order: assigned.next!, to: 'repairing', at: AT, by: '张工', byRole: 'repair', note: '已接单' })
    expect(repairing.next?.status).toBe('repairing')

    const submitted = advance({
      order: { ...repairing.next!, measures: '重新固定并加固支架' },
      to: 'submitted',
      at: AT,
      by: '张工',
      byRole: 'repair',
      note: '',
    })
    expect(submitted.next?.status).toBe('submitted')
  })

  it('跳步被拦截：未派工不能直接提交待验收', () => {
    const out = advance({ order: order(), to: 'submitted', at: AT, by: '张工', byRole: 'repair', note: '' })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('不能直接转为')
  })

  it('只有安全管理人员能派工；且派工必须指定维修人', () => {
    const out = advance({ order: order(), to: 'assigned', at: AT, by: '张工', byRole: 'repair', note: '' })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('派工由学校安全管理人员执行')

    const noAssignee = advance({ order: order(), to: 'assigned', at: AT, by: '安全管理员', byRole: 'safety', note: '' })
    expect(noAssignee.ok).toBe(false)
    expect(noAssignee.error).toContain('必须指定维修人')
  })

  it('提交待验收必须填写维修措施', () => {
    const repairing = order({ status: 'repairing', assignee: '张工' })
    const out = advance({ order: repairing, to: 'submitted', at: AT, by: '张工', byRole: 'repair', note: '' })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('维修措施')
  })

  it('验收退回必须写原因，退回后可继续处理', () => {
    const submitted = order({ status: 'submitted', assignee: '张工', measures: '已加固' })
    const denied = advance({ order: submitted, to: 'returned', at: AT, by: '安全管理员', byRole: 'safety', note: '  ' })
    expect(denied.ok).toBe(false)

    const returned = advance({ order: submitted, to: 'returned', at: AT, by: '安全管理员', byRole: 'safety', note: '照片看不清固定位置' })
    expect(returned.next?.status).toBe('returned')
    expect(returned.next?.reviews.at(-1)?.result).toBe('fail')
    expect(returned.next?.reviews.at(-1)?.byRole).toBe('学校安全管理人员')
    expect(advance({ order: returned.next!, to: 'repairing', at: AT, by: '张工', byRole: 'repair', note: '重新处理' }).ok).toBe(true)
  })

  it('验收通过与退回只限安全管理人员（验收人员身份也不能验收）', () => {
    const submitted = order({ status: 'submitted', assignee: '张工', measures: '已加固' })
    for (const role of ['reviewer', 'property', 'inspector', 'repair']) {
      const verify = advance({ order: submitted, to: 'verified', at: AT, by: '张三', byRole: role, note: '同意验收' })
      expect(verify.ok).toBe(false)
      expect(verify.error).toContain('学校安全管理人员')

      const back = advance({ order: submitted, to: 'returned', at: AT, by: '张三', byRole: role, note: '不合格' })
      expect(back.ok).toBe(false)
      expect(back.error).toContain('学校安全管理人员')
    }
  })

  it('验收通过后问题只到待复查，不自动关闭', () => {
    const submitted = order({ status: 'submitted', assignee: '张工', measures: '已加固' })
    const verified = advance({ order: submitted, to: 'verified', at: AT, by: '安全管理员', byRole: 'safety', note: '前后照片齐全，通过' })
    expect(verified.next?.status).toBe('verified')

    const actor = { orderNo: 'WO-20260920-001', at: AT, by: '安全管理员', byRole: '学校安全管理人员' }
    const next = issueAfterVerify(order({ status: 'repairing' }), actor)
    expect(next.status).toBe('pending_recheck')
    expect(next.status).not.toBe('closed')
    expect(next.timeline.at(-1)?.action).toBe('进入待复查')

    // 已待复查或已关闭的问题原样返回，不重复追加节点
    const settled = order({ status: 'pending_recheck' })
    expect(issueAfterVerify(settled, actor)).toBe(settled)
  })

  it('接单人是否被派工人：按角色名或姓名任一匹配', () => {
    const assigned = order({ assignee: '维修人员' })
    expect(isAssignedTo(assigned, { roleKey: 'repair', name: '张三' })).toBe(true)
    expect(isAssignedTo(assigned, { roleKey: 'property', name: '张三' })).toBe(false)
    expect(isAssignedTo(assigned, { roleKey: 'property', name: '维修人员' })).toBe(true)
    expect(isAssignedTo(order(), { roleKey: 'repair', name: '张三' })).toBe(false)
  })
})

describe('事件关闭的处置依据', () => {
  it('有验收通过的关联工单即可作为依据', () => {
    const out = closeBasis({ orders: [order({ status: 'verified', eventId: 'evt_1' })], eventId: 'evt_1', pointId: 'pnt_1', noRepairNote: '' })
    expect(out.ok).toBe(true)
    expect(out.kind).toBe('work_order')
    expect(out.reason).toContain('WO-20260920-001')
  })

  it('工单未验收通过时不给依据，并说明卡在哪一步', () => {
    const out = closeBasis({ orders: [order({ status: 'submitted', eventId: 'evt_1' })], eventId: 'evt_1', pointId: 'pnt_1', noRepairNote: '' })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('尚未验收通过')
  })

  it('没有工单时，安全管理人员填写核查结论也可作为依据', () => {
    const out = closeBasis({ orders: [], eventId: 'evt_1', pointId: 'pnt_1', noRepairNote: '现场核查确认无需维修，探头读数恢复正常' })
    expect(out.ok).toBe(true)
    expect(out.kind).toBe('no_repair')
  })

  it('既没有验收工单也没有核查结论时明确拒绝', () => {
    const out = closeBasis({ orders: [], eventId: 'evt_1', pointId: 'pnt_1', noRepairNote: '好' })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('缺少处置依据')
  })
})

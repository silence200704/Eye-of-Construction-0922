/**
 * V0.3 完整性检查测试：标签唯一性、巡检引用、处置链引用与附件归属。
 * 口径：断链必须报出来，不能让"看起来完整"混过"真的对得上"。
 */
import { describe, expect, it } from 'vitest'
import { scanIntegrity } from '@/core/integrity'
import type { IntegrityInput } from '@/core/integrity'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'
import { makeBuilding, makeFloor, makePoint } from '../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }

function base(): IntegrityInput {
  return {
    buildings: [makeBuilding({ id: 'bld_1' })],
    floors: [makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })],
    points: [makePoint({ id: 'pnt_1', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })],
    devices: [],
    baselines: [],
    records: [],
    events: [],
    plans: [],
    tasks: [],
    issues: [],
    workOrders: [],
    attachments: [],
  }
}

function plan(override: Partial<InspectionPlan> = {}): InspectionPlan {
  return {
    ...AUDIT,
    id: 'plan_1',
    code: 'PLAN-20260920-001',
    name: '二层走廊巡检',
    kind: 'patrol',
    buildingId: 'bld_1',
    floorIds: ['flr_1'],
    pointIds: ['pnt_1'],
    cycle: { unit: 'day', interval: 1, atTime: '09:00' },
    startDate: '2026-09-01',
    endDate: null,
    owner: '李老师',
    executorRole: 'inspector',
    checklist: [],
    remark: '',
    ...override,
  }
}

function task(override: Partial<InspectionTask> = {}): InspectionTask {
  return {
    ...AUDIT,
    id: 'task_1',
    taskNo: 'TK-20260920-001',
    planId: 'plan_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    plannedAt: AT,
    dueAt: AT,
    status: 'pending',
    results: [],
    issueIds: [],
    ...override,
  }
}

function issue(override: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    ...AUDIT,
    id: 'iss_1',
    issueNo: 'ISS-20260920-001',
    source: 'inspection',
    submissionKey: 'k1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    eventId: null,
    taskId: null,
    anomalyType: '探头松动',
    description: '',
    photos: [],
    status: 'pending_review',
    reviewAction: null,
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

function attachment(override: Partial<IssueAttachment> = {}): IssueAttachment {
  return {
    id: 'att_1',
    issueId: 'iss_1',
    workOrderId: null,
    kind: 'scene',
    fileName: '现场.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    width: 640,
    height: 480,
    uploadedAt: AT,
    uploadedBy: '巡检人员',
    capturedAt: AT,
    blob: new Blob([], { type: 'image/jpeg' }),
    thumb: new Blob([], { type: 'image/jpeg' }),
    ...override,
  }
}

function kindsOf(data: IntegrityInput): string[] {
  return scanIntegrity(data).map((row) => row.kind)
}

describe('NFC 标签编号唯一性', () => {
  it('两个活动测点绑同一编号时报错', () => {
    const data = base()
    data.points = [
      makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', nfc: { code: 'NFC-DUP', version: 1, boundAt: AT, boundBy: '测试', remark: '' } }),
      makePoint({ id: 'pnt_2', code: 'B03-F2-TILT01', nfc: { code: 'NFC-DUP', version: 1, boundAt: AT, boundBy: '测试', remark: '' } }),
    ]
    const issues = scanIntegrity(data)
    const dup = issues.filter((row) => row.kind === 'NFC 标签编号重复')
    expect(dup).toHaveLength(1)
    expect(dup[0].level).toBe('error')
    expect(dup[0].message).toContain('一个编号只能绑一个测点')
  })

  it('已归档的点位不参与冲突判定（历史标签不挡新绑定）', () => {
    const data = base()
    data.points = [
      makePoint({ id: 'pnt_1', status: 'archived', nfc: { code: 'NFC-X', version: 1, boundAt: AT, boundBy: '测试', remark: '' } }),
      makePoint({ id: 'pnt_2', code: 'B03-F2-TILT01', nfc: { code: 'NFC-X', version: 1, boundAt: AT, boundBy: '测试', remark: '' } }),
    ]
    expect(kindsOf(data)).not.toContain('NFC 标签编号重复')
  })
})

describe('巡检计划与任务的引用', () => {
  it('计划指向的楼栋、楼层、测点失效时报错', () => {
    const data = base()
    data.plans = [plan({ buildingId: 'bld_gone', floorIds: ['flr_gone'], pointIds: ['pnt_gone'] })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('计划楼栋引用失效')
    expect(kinds).toContain('计划楼层引用失效')
    expect(kinds).toContain('计划测点引用失效')
  })

  it('计划没有必查点只是警告，不是断链', () => {
    const data = base()
    data.plans = [plan({ pointIds: [] })]
    const issues = scanIntegrity(data).filter((row) => row.kind === '计划没有必查点')
    expect(issues).toHaveLength(1)
    expect(issues[0].level).toBe('warn')
  })

  it('任务关联的计划或点位失效时报错', () => {
    const data = base()
    data.plans = [plan()]
    data.tasks = [task({ planId: 'plan_gone', results: [{ pointId: 'pnt_gone' } as never] })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('任务计划引用失效')
    expect(kinds).toContain('任务测点引用失效')
  })
})

describe('问题、工单与附件的引用', () => {
  it('问题与工单的关联对象失效时报错', () => {
    const data = base()
    data.issues = [issue({ taskId: 'task_gone', eventId: 'evt_gone', duplicateOf: 'iss_gone' })]
    data.workOrders = [order({ issueId: 'iss_gone', eventId: 'evt_gone', pointId: 'pnt_gone' })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('问题任务引用失效')
    expect(kinds).toContain('问题事件引用失效')
    expect(kinds).toContain('重复关联失效')
    expect(kinds).toContain('工单问题引用失效')
    expect(kinds).toContain('工单事件引用失效')
    expect(kinds).toContain('工单测点引用失效')
  })

  it('照片 ID 在附件表里找不到时报错', () => {
    const data = base()
    data.issues = [issue({ photos: ['att_missing'] })]
    data.workOrders = [order({ photos: ['att_missing'] })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('问题照片丢失')
    expect(kinds).toContain('工单照片丢失')
  })

  it('附件既没关联问题也没关联工单时报错', () => {
    const data = base()
    data.attachments = [attachment({ issueId: null, workOrderId: null })]
    const issues = scanIntegrity(data).filter((row) => row.kind === '附件未关联对象')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('游离数据')
  })

  it('附件关联到不存在的对象时报错', () => {
    const data = base()
    data.attachments = [attachment({ issueId: 'iss_gone', workOrderId: 'wo_gone' })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('附件问题引用失效')
    expect(kinds).toContain('附件工单引用失效')
  })

  it('关联完整的一条链路不报任何错', () => {
    const data = base()
    data.plans = [plan()]
    data.tasks = [task({ results: [{ pointId: 'pnt_1' } as never] })]
    data.issues = [issue({ taskId: 'task_1', photos: ['att_1'] })]
    data.workOrders = [order({ photos: ['att_1'] })]
    data.attachments = [attachment()]
    const errors = scanIntegrity(data).filter((row) => row.level === 'error')
    expect(errors).toEqual([])
  })
})

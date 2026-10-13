/**
 * V0.3 完整性检查测试：标签唯一性、巡检引用、处置链引用与附件归属。
 * 口径：断链必须报出来，不能让"看起来完整"混过"真的对得上"。
 */
import { describe, expect, it } from 'vitest'
import { scanIntegrity } from '@/core/integrity'
import type { IntegrityInput } from '@/core/integrity'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'
import { makeBuilding, makeDevice, makeFloor, makePoint } from '../fixtures'

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
    maintenancePlans: [],
    maintenanceTasks: [],
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
    // 两张照片各自归属：问题照片归问题、工单照片归工单。
    // 不能再用"同一张照片同时列在问题和工单里"——那正是"归属不唯一"，会被新校验判为错误。
    data.issues = [issue({ taskId: 'task_1', photos: ['att_issue'] })]
    data.workOrders = [order({ photos: ['att_order'] })]
    data.attachments = [
      attachment({ id: 'att_issue', issueId: 'iss_1', workOrderId: null }),
      attachment({ id: 'att_order', issueId: null, workOrderId: 'wo_1' }),
    ]
    const errors = scanIntegrity(data).filter((row) => row.level === 'error')
    expect(errors).toEqual([])
  })

  it('照片存在但归属别的对象时报错（双向校验）', () => {
    const data = base()
    data.issues = [issue({ photos: ['att_other'] })]
    data.attachments = [attachment({ id: 'att_other', issueId: 'iss_9', workOrderId: null })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('问题照片归属不符')
    expect(kinds).not.toContain('问题照片丢失')
  })

  it('工单列出的照片必须归属本工单', () => {
    const data = base()
    data.issues = [issue()]
    data.workOrders = [order({ photos: ['att_other'] })]
    data.attachments = [attachment({ id: 'att_other', issueId: 'iss_1', workOrderId: null })]
    expect(kindsOf(data)).toContain('工单照片归属不符')
  })
})

/**
 * 保养照片的归属校验（V1-D）：照片必须有且只有一个归属，且指向的任务真实存在。
 */
describe('保养照片的归属', () => {
  it('照片挂到保养任务上：任务存在即通过', () => {
    const data = withMaintenanceTask()
    data.attachments = [attachment({ id: 'att_m1', issueId: null, workOrderId: null, maintenanceTaskId: 'mt_1' })]
    const kinds = kindsOf(data)
    expect(kinds).not.toContain('附件未关联对象')
    expect(kinds).not.toContain('附件保养任务引用失效')
  })

  it('指向不存在的保养任务时报错', () => {
    const data = withMaintenanceTask()
    data.attachments = [attachment({ id: 'att_m1', issueId: null, workOrderId: null, maintenanceTaskId: 'mt_gone' })]
    expect(kindsOf(data)).toContain('附件保养任务引用失效')
  })

  it('同时挂问题与工单属于归属不唯一，两个对象都要各查一遍引用', () => {
    const data = withMaintenanceTask()
    data.attachments = [attachment({ id: 'att_m1', issueId: 'iss_1', workOrderId: 'wo_1' })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('附件归属不唯一')
  })

  it('保养照片存在但归属别的任务时报错', () => {
    const data = withMaintenanceTask()
    const task = data.maintenanceTasks![0]
    task.execution = {
      at: AT,
      by: '孙老师',
      byRole: '维修人员',
      checklist: [],
      measures: '已紧固',
      materials: '',
      photos: ['att_wrong'],
      nextDueDate: '2026-10-01',
      note: '',
    }
    data.attachments = [attachment({ id: 'att_wrong', issueId: null, workOrderId: null, maintenanceTaskId: 'mt_other' })]
    expect(kindsOf(data)).toContain('保养照片归属不符')
  })

  it('任务执行记录里列出的照片必须真的在附件表里', () => {
    const data = withMaintenanceTask()
    const task = data.maintenanceTasks![0]
    task.execution = {
      at: AT,
      by: '孙老师',
      byRole: '维修人员',
      checklist: [],
      measures: '已紧固',
      materials: '',
      photos: ['att_missing'],
      nextDueDate: '2026-10-01',
      note: '',
    }
    expect(kindsOf(data)).toContain('保养照片丢失')
  })
})

describe('保养数据的引用校验', () => {
  const baseWithPlan = (): ReturnType<typeof base> => {
    const data = base()
    data.devices = [makeDevice({ id: 'dev_1', pointId: 'pnt_1' })]
    data.maintenancePlans = [maintenancePlan()]
    return data
  }

  it('计划与任务引用都完整时不报错', () => {
    const data = baseWithPlan()
    data.maintenanceTasks = [maintenanceTask({ status: 'pending', execution: null })]
    const errors = scanIntegrity(data).filter((row) => row.level === 'error')
    expect(errors).toEqual([])
  })

  it('计划指向不存在的设备或测点时报错', () => {
    const data = baseWithPlan()
    data.maintenancePlans = [maintenancePlan({ deviceId: 'dev_gone', pointId: 'pnt_gone' })]
    const kinds = kindsOf(data)
    expect(kinds).toContain('保养计划设备引用失效')
    expect(kinds).toContain('保养计划测点引用失效')
  })

  it('任务指向不存在的计划、或快照位置对不上档案时报错', () => {
    const data = baseWithPlan()
    data.maintenanceTasks = [maintenanceTask({ planId: 'plan_m_gone' })]
    expect(kindsOf(data)).toContain('保养任务计划引用失效')

    // 快照里的楼层指向不存在的档案（设备被调拨、楼层被删后可能出现）
    const moved = baseWithPlan()
    moved.maintenanceTasks = [maintenanceTask({ snapshot: { ...maintenanceTask().snapshot, floorId: 'flr_gone' } })]
    expect(kindsOf(moved)).toContain('保养任务快照楼层失效')
  })

  it('计划没有检查项、任务标记完成却没有执行记录都报错', () => {
    const noChecklist = baseWithPlan()
    noChecklist.maintenancePlans = [maintenancePlan({ checklist: [] })]
    expect(kindsOf(noChecklist)).toContain('保养计划缺少检查项')

    const doneNoExecution = baseWithPlan()
    doneNoExecution.maintenanceTasks = [maintenanceTask({ status: 'done', execution: null })]
    expect(kindsOf(doneNoExecution)).toContain('保养任务缺少执行记录')
  })
})

/** 数据集里放一条保养计划（设备 / 测点 / 楼栋都指向 base() 里的档案）。 */
function maintenancePlan(override: Partial<MaintenancePlan> = {}): MaintenancePlan {
  return {
    createdAt: AT,
    createdBy: '测试',
    updatedAt: AT,
    updatedBy: '测试',
    id: 'plan_m1',
    code: 'MP-20260920-001',
    name: '裂缝传感器月度保养',
    deviceId: 'dev_1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    cycle: { unit: 'month', interval: 1, atTime: '09:00' },
    startDate: '2026-09-01',
    endDate: null,
    owner: '孙老师',
    checklist: [{ key: 'surface', label: '外壳是否完好', required: true, hint: '' }],
    enabled: true,
    remark: '',
    ...override,
  }
}

/** 数据集里放一条保养任务（快照位置指向 base() 的楼栋与楼层）。 */
function maintenanceTask(override: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    createdAt: AT,
    createdBy: '测试',
    updatedAt: AT,
    updatedBy: '测试',
    id: 'mt_1',
    taskNo: 'MT-20260920-001',
    planId: 'plan_m1',
    deviceId: 'dev_1',
    plannedAt: AT,
    dueAt: '2026-09-20T15:59:59.000Z',
    status: 'pending',
    snapshot: {
      planCode: 'MP-20260920-001',
      planName: '裂缝传感器月度保养',
      deviceCode: 'DEV-1',
      deviceName: '裂缝计',
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      floorId: 'flr_1',
      zoneId: '二层走廊',
      owner: '孙老师',
      cycle: { unit: 'month', interval: 1, atTime: '09:00' },
      checklist: [],
    },
    execution: null,
    timeline: [],
    ...override,
  }
}

function withMaintenanceTask(): ReturnType<typeof base> {
  const data = base()
  data.devices = [makeDevice({ id: 'dev_1', pointId: 'pnt_1' })]
  data.maintenanceTasks = [maintenanceTask()]
  return data
}

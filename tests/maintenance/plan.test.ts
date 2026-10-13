/**
 * 设备保养的计划与任务判定测试（V1-D 第①②步）。
 *
 * 口径：复用巡检已验证的四条纪律 —— 周期命中、业务键幂等、计划快照、判定看"本次操作后的状态"。
 * 但不复用 InspectionTask：保养一个周期只完成一次，还要登记下次保养日期。
 */
import { describe, expect, it } from 'vitest'
import {
  isMaintenanceOverdue,
  maintenanceAnswersOf,
  maintenanceCompletedRow,
  maintenanceDaysLeft,
  maintenanceKeyOf,
  maintenanceRunsOf,
  maintenanceSnapshotOf,
  nextDueDateOf,
  planMaintenanceCompletion,
  validateMaintenancePlan,
} from '@/core/maintenance/plan'
import type { ChecklistItem } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceTask } from '@/types/maintenance'

const AT = '2026-09-20T01:00:00.000Z'

/** 本地日期串（YYYY-MM-DD）：任务执行时刻存的是本地时间，比较时不能走 toISOString 折算成 UTC。 */
function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const CHECKLIST: ChecklistItem[] = [
  { key: 'surface', label: '外壳与接线是否完好', required: true, hint: '' },
  { key: 'fixed', label: '固定螺栓是否牢固', required: true, hint: '' },
]

function plan(override: Partial<MaintenancePlan> = {}): MaintenancePlan {
  return {
    ...AUDIT,
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
    checklist: CHECKLIST.map((item) => ({ ...item })),
    enabled: true,
    remark: '',
    ...override,
  }
}

function task(override: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    ...AUDIT,
    id: 'plan_m1@2026-09-01T01:00:00.000Z',
    taskNo: 'MT-20260901-001',
    planId: 'plan_m1',
    deviceId: 'dev_1',
    plannedAt: '2026-09-01T01:00:00.000Z',
    dueAt: '2026-09-01T15:59:59.000Z',
    status: 'pending',
    snapshot: maintenanceSnapshotOf({ plan: plan(), deviceCode: 'B03-F2-CRACK01-DEV1', deviceName: '裂缝计', floorId: 'flr_1', zoneId: '二层走廊' }),
    execution: null,
    timeline: [],
    ...override,
  }
}

describe('保养周期命中与任务业务键', () => {
  it('按天/周/月命中执行日', () => {
    const monthly = plan()
    const runs = maintenanceRunsOf(monthly, new Date('2026-09-01T00:00:00'), new Date('2026-12-31T00:00:00'))
    expect(runs.map(localDay)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'])

    const weekly = plan({ cycle: { unit: 'week', interval: 1, atTime: '09:00' } })
    const weekRuns = maintenanceRunsOf(weekly, new Date('2026-09-01T00:00:00'), new Date('2026-09-30T00:00:00'))
    expect(weekRuns).toHaveLength(5)

    const daily = plan({ cycle: { unit: 'day', interval: 3, atTime: '09:00' }, startDate: '2026-09-01' })
    expect(maintenanceRunsOf(daily, new Date('2026-09-01T00:00:00'), new Date('2026-09-10T00:00:00'))).toHaveLength(4)
  })

  it('业务键 = 计划ID@执行时刻：同计划同刻同键，不同刻不同键', () => {
    expect(maintenanceKeyOf('plan_m1', '2026-09-01T01:00:00.000Z')).toBe('plan_m1@2026-09-01T01:00:00.000Z')
    expect(maintenanceKeyOf('plan_m1', '2026-10-01T01:00:00.000Z')).not.toBe(maintenanceKeyOf('plan_m1', '2026-09-01T01:00:00.000Z'))
  })
})

describe('计划快照', () => {
  it('快照保存生成当时的值，之后改计划不会改写它', () => {
    const source = plan()
    const snapshot = maintenanceSnapshotOf({ plan: source, deviceCode: 'DEV-1', deviceName: '裂缝计', floorId: 'flr_1', zoneId: '二层走廊' })
    // 改计划（含清单里的对象）
    source.owner = '换了别人'
    source.checklist[0].label = '改过的检查项'
    source.cycle.interval = 3

    expect(snapshot.owner).toBe('孙老师')
    expect(snapshot.checklist[0].label).toBe('外壳与接线是否完好')
    expect(snapshot.cycle.interval).toBe(1)
  })

  it('位置也固定进快照：设备日后调拨，历史任务仍能说明当时在哪执行', () => {
    const source = plan()
    const snapshot = maintenanceSnapshotOf({ plan: source, deviceCode: 'DEV-1', deviceName: '裂缝计', floorId: 'flr_1', zoneId: '二层走廊' })
    expect(snapshot.buildingId).toBe('bld_1')
    expect(snapshot.floorId).toBe('flr_1')
    expect(snapshot.zoneId).toBe('二层走廊')
    // 计划改到别的楼栋，快照不动
    source.buildingId = 'bld_2'
    expect(snapshot.buildingId).toBe('bld_1')
  })
})

describe('下次保养日期与逾期', () => {
  it('由周期推算下一次日期（月度取下一个自然月同日）', () => {
    expect(nextDueDateOf({ unit: 'month', interval: 1, atTime: '09:00' }, '2026-09-01', '2026-09-01')).toBe('2026-10-01')
    expect(nextDueDateOf({ unit: 'week', interval: 1, atTime: '09:00' }, '2026-09-01', '2026-09-01')).toBe('2026-09-08')
    expect(nextDueDateOf({ unit: 'day', interval: 10, atTime: '09:00' }, '2026-09-01', '2026-09-01')).toBe('2026-09-11')
  })

  it('长周期也算得对：两年一次不会退回"今天"，月末溢出落到当月最后一天', () => {
    // 回归：早先逐天搜索带上限（400 天），两年一次会静默返回"今天"
    expect(nextDueDateOf({ unit: 'month', interval: 24, atTime: '09:00' }, '2026-09-01', '2026-09-01')).toBe('2028-09-01')
    expect(nextDueDateOf({ unit: 'day', interval: 800, atTime: '09:00' }, '2026-09-01', '2026-09-01')).toBe('2028-11-09')
    // 1 月 31 日 + 1 个月 → 2 月只有 28 天，落到 2 月 28 日（与巡检周期同一条规则）
    expect(nextDueDateOf({ unit: 'month', interval: 1, atTime: '09:00' }, '2026-01-31', '2026-01-31')).toBe('2026-02-28')
    expect(nextDueDateOf({ unit: 'month', interval: 1, atTime: '09:00' }, '2024-01-31', '2024-01-31')).toBe('2024-02-29')
  })

  it('未完成且过了当日截止时刻才算逾期；已完成永不算逾期', () => {
    const now = new Date('2026-09-03T09:00:00.000Z')
    expect(isMaintenanceOverdue(task(), now)).toBe(true)
    expect(isMaintenanceOverdue(task({ dueAt: '2026-09-10T15:59:59.000Z' }), now)).toBe(false)
    expect(isMaintenanceOverdue(task({ status: 'done' }), now)).toBe(false)
  })

  it('剩余/逾期天数按本地日期算', () => {
    expect(maintenanceDaysLeft(task({ dueAt: '2026-09-25T15:59:59.000Z' }), '2026-09-20')).toBe(5)
    expect(maintenanceDaysLeft(task({ dueAt: '2026-09-18T15:59:59.000Z' }), '2026-09-20')).toBe(-2)
  })
})

describe('保养计划校验', () => {
  it('设备、负责人、检查项、日期缺一不可', () => {
    const base = { name: '月度保养', deviceId: 'dev_1', cycle: { unit: 'month' as const, interval: 1, atTime: '09:00' }, startDate: '2026-09-01', endDate: null, owner: '孙老师', checklist: CHECKLIST }
    expect(validateMaintenancePlan(base).ok).toBe(true)
    expect(validateMaintenancePlan({ ...base, deviceId: '' }).errors).toContain('必须选择要保养的设备')
    expect(validateMaintenancePlan({ ...base, owner: '  ' }).errors).toContain('必须指定保养负责人')
    expect(validateMaintenancePlan({ ...base, checklist: [] }).errors).toContain('至少要有一条保养检查项，否则执行时没有依据')
    expect(validateMaintenancePlan({ ...base, startDate: '2026-02-31' }).errors).toContain('开始日期不是合法日期')
    expect(validateMaintenancePlan({ ...base, endDate: '2026-08-01' }).errors).toContain('结束日期不能早于开始日期')
  })
})

describe('执行保养的判定（看本次操作后的状态）', () => {
  const answers = maintenanceAnswersOf(CHECKLIST)

  it('必答项没答完不能提交，并指出还差哪几项', () => {
    const out = planMaintenanceCompletion({ task: task(), answers, measures: '已紧固螺栓', nextDueDate: '2026-10-01' })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('2 条必答检查项')
    expect(out.error).toContain('外壳与接线是否完好')
  })

  it('措施必填，下次保养日期要合法', () => {
    const answered = answers.map((row) => ({ ...row, result: 'ok' as const }))
    expect(planMaintenanceCompletion({ task: task(), answers: answered, measures: ' ', nextDueDate: '2026-10-01' }).error).toContain('维护措施')
    expect(planMaintenanceCompletion({ task: task(), answers: answered, measures: '已紧固螺栓', nextDueDate: '2026-02-31' }).error).toContain('合法日期')
    expect(planMaintenanceCompletion({ task: task(), answers: answered, measures: '已紧固螺栓', nextDueDate: '2026-10-01' }).ok).toBe(true)
  })

  it('一个周期只执行一次：已完成的任务不能再完成', () => {
    const done = task({ status: 'done' })
    const out = planMaintenanceCompletion({ task: done, answers, measures: '已紧固螺栓', nextDueDate: '2026-10-01' })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('已经完成过了')
  })

  it('完成后的任务行：状态、执行记录、下次日期与时间线一次成型', () => {
    const answered = answers.map((row) => ({ ...row, result: 'ok' as const }))
    const row = maintenanceCompletedRow({
      task: task(),
      answers: answered,
      measures: '重新紧固固定螺栓，清洁外壳',
      materials: '防松胶 ×1',
      photos: ['att_1'],
      nextDueDate: '2026-10-01',
      note: '读数正常',
      abnormalNote: '螺栓有轻微锈蚀，已现场除锈',
      issueId: null,
      at: '2026-09-01T02:00:00.000Z',
      by: '孙老师',
      byRole: '维修人员',
    })
    expect(row.status).toBe('done')
    expect(row.execution?.abnormalNote).toContain('轻微锈蚀')
    expect(row.execution?.issueId).toBeNull()
    expect(row.execution?.measures).toBe('重新紧固固定螺栓，清洁外壳')
    expect(row.execution?.nextDueDate).toBe('2026-10-01')
    expect(row.execution?.photos).toEqual(['att_1'])
    expect(row.timeline.at(-1)?.action).toBe('完成保养')
    expect(row.timeline.at(-1)?.detail).toContain('下次保养 2026-10-01')
  })
})

describe('保养任务进备份', () => {
  it('计划与任务随备份往返，旧备份缺字段按空数组处理', async () => {
    const { buildBackup, parseBackup, toDataset } = await import('@/db/backup')
    const dataset = {
      buildings: [], floors: [], points: [], devices: [], baselines: [], records: [], audits: [], rules: [],
      events: [], notifications: [], plans: [], tasks: [], issues: [], workOrders: [], attachments: [],
      maintenancePlans: [plan()],
      maintenanceTasks: [task()],
    }
    const pkg = await buildBackup(dataset, '演示操作员')
    expect(pkg.counts.maintenancePlans).toBe(1)
    const parsed = parseBackup(JSON.stringify(pkg))
    expect(parsed.ok).toBe(true)
    const restored = toDataset(parsed.data!)
    expect(restored.maintenancePlans).toHaveLength(1)
    expect(restored.maintenanceTasks[0].taskNo).toBe('MT-20260901-001')

    // 旧备份（没有这两个字段）读取时按空数组处理，不炸
    const legacy = parseBackup(
      JSON.stringify({ ...pkg, data: { ...pkg.data, maintenancePlans: undefined, maintenanceTasks: undefined } }),
    )
    expect(toDataset(legacy.data!).maintenanceTasks).toEqual([])
  })
})

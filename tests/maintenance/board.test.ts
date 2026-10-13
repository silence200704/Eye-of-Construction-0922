/**
 * 保养工作台的筛选、计数、台账、日历与分区测试（V1-D 工作线 C）。
 *
 * 锁定的口径：
 * ① 四个视图各自回答一个问题，徽标条数与列表长度同源；
 * ② 台账的"下次保养日期"优先取现场登记值，没有才按周期推算，推不出来就说"没有"，不编日期；
 * ③ 日历只反映真实的计划执行日与已存在的任务；
 * ④ **保养逾期与结构预警分属两个区**：保养逾期再多也不会让结构预警涨一条。
 */
import { describe, expect, it } from 'vitest'
import {
  MAINTENANCE_VIEWS,
  maintenanceCalendar,
  maintenanceCalendarDayOf,
  maintenanceDayPlanHits,
  maintenanceLedger,
  maintenancePlannedDay,
  maintenanceRecordsOf,
  maintenanceTaskState,
  maintenanceTasksOnDay,
  maintenanceViewBadges,
  maintenanceViewOf,
  maintenanceZones,
  planNextRunDate,
  summarizeText,
  type MaintenanceBoardInput,
} from '@/core/maintenance/board'
import { maintenanceKeyOf, maintenanceSnapshotOf } from '@/core/maintenance/plan'
import type { Device } from '@/types/domain'
import type { WorkOrder } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceTask } from '@/types/maintenance'
import { makeDevice, makeEvent } from '../fixtures'

const AUDIT = { createdAt: '2026-09-01T00:00:00.000Z', createdBy: '测试', updatedAt: '2026-09-01T00:00:00.000Z', updatedBy: '测试' }
const TODAY = '2026-09-20'
/** 与 TODAY 同一天的当下时刻（本地 2026-09-20 12:00） */
const NOW = new Date('2026-09-20T12:00:00')
const CHECKLIST = [
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
    cycle: { unit: 'day', interval: 1, atTime: '09:00' },
    startDate: '2026-09-01',
    endDate: null,
    owner: '孙老师',
    checklist: CHECKLIST.map((item) => ({ ...item })),
    enabled: true,
    remark: '',
    ...override,
  }
}

/** 任务：默认是"今天待执行"的那条（本机时区的当日 09:00）；换计划要连业务键一起换 */
function task(plannedDay: string, override: Partial<MaintenanceTask> = {}): MaintenanceTask {
  const plannedAt = new Date(`${plannedDay}T09:00:00`).toISOString()
  const planId = override.planId ?? 'plan_m1'
  const source = plan()
  return {
    ...AUDIT,
    id: maintenanceKeyOf(planId, plannedAt),
    taskNo: `MT-${plannedDay.replace(/-/g, '')}-001`,
    planId,
    deviceId: 'dev_1',
    plannedAt,
    dueAt: new Date(`${plannedDay}T23:59:59`).toISOString(),
    status: 'pending',
    snapshot: maintenanceSnapshotOf({ plan: source, deviceCode: 'DEV-1', deviceName: '裂缝位移探头', floorId: 'flr_1', zoneId: '二层走廊' }),
    execution: null,
    timeline: [],
    ...override,
  }
}

/** 已完成的任务：执行记录填全，台账与日历都要读它 */
function doneTask(plannedDay: string, override: Partial<MaintenanceTask> = {}): MaintenanceTask {
  const base = task(plannedDay, override)
  return {
    ...base,
    status: 'done',
    execution: {
      at: `${plannedDay}T10:30:00.000Z`,
      by: '孙老师',
      byRole: '维修人员',
      checklist: base.snapshot.checklist.map((item) => ({ key: item.key, label: item.label, result: 'ok' as const, note: '' })),
      measures: '重新紧固固定螺栓并清洁外壳，接线端子重新压接',
      materials: '防松胶 ×1',
      photos: ['att_1', 'att_2'],
      nextDueDate: '2026-10-20',
      note: '',
      ...(override.execution ?? {}),
    },
  }
}

function order(override: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...AUDIT,
    id: 'wo_1',
    orderNo: 'WO-20260920-001',
    origin: 'issue',
    issueId: null,
    eventId: null,
    pointId: 'pnt_1',
    title: '探头支架松动',
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

function input(override: Partial<MaintenanceBoardInput> = {}): MaintenanceBoardInput {
  return {
    plans: [],
    tasks: [],
    devices: [],
    workOrders: [],
    events: [],
    actor: '孙老师',
    todayKey: TODAY,
    now: NOW,
    ...override,
  }
}

describe('任务视图筛选', () => {
  const today = task(TODAY)
  const yesterday = task('2026-09-18')
  const tomorrow = task('2026-09-25')
  // 另一条计划、同一天的另一个负责人：同名同刻的任务不存在（业务键主键），所以换计划
  const otherOwner = task(TODAY, { planId: 'plan_m2', snapshot: { ...task(TODAY).snapshot, owner: '周老师' } })
  const finished = doneTask('2026-09-19')
  const data = input({ plans: [plan()], tasks: [today, yesterday, tomorrow, otherOwner, finished] })

  it('今日待办只留执行日是今天的（按本地日，不按 UTC 日）', () => {
    const view = maintenanceViewOf(data, 'today')
    expect(view.tasks.map((row) => row.id).sort()).toEqual([today.id, otherOwner.id].sort())
    expect(view.count).toBe(2)
  })

  it('我的保养按负责人取，含已完成的历史任务', () => {
    const view = maintenanceViewOf(input({ ...data, tasks: [...data.tasks, finished] }), 'mine')
    expect(view.tasks.some((row) => row.id === today.id)).toBe(true)
    expect(view.tasks.some((row) => row.id === otherOwner.id)).toBe(false)
  })

  it('全部待办只留未完成的', () => {
    const view = maintenanceViewOf(data, 'all')
    expect(view.tasks.some((row) => row.status === 'done')).toBe(false)
    expect(view.count).toBe(4)
  })

  it('逾期用未完成且过了当日截止时刻判定，已完成的不算', () => {
    const view = maintenanceViewOf(data, 'overdue')
    expect(view.tasks.map((row) => row.id)).toEqual([yesterday.id])
    expect(maintenanceViewOf(input({ tasks: [doneTask('2026-09-01')] }), 'overdue').count).toBe(0)
  })

  it('视图里的任务按执行时刻升序，最早的排最前', () => {
    const rows = maintenanceViewOf(data, 'all').tasks.map((row) => row.plannedAt)
    expect([...rows].sort()).toEqual(rows)
  })

  it('四个视图徽标与各自列表长度同源', () => {
    const badges = maintenanceViewBadges(data)
    expect(badges).toHaveLength(MAINTENANCE_VIEWS.length)
    for (const badge of badges) {
      expect(badge.count).toBe(maintenanceViewOf(data, badge.key).count)
    }
    expect(badges.find((row) => row.key === 'overdue')?.label).toBe('逾期')
  })

  it('任务状态文案给天数，不靠颜色单独表意', () => {
    expect(maintenanceTaskState(doneTask('2026-09-18'), TODAY, NOW)).toEqual({ overdue: false, daysLeft: 0, label: '已完成', tone: 'green' })
    expect(maintenanceTaskState(task('2026-09-18'), TODAY, NOW)).toMatchObject({ overdue: true, label: '逾期 2 天', tone: 'red' })
    expect(maintenanceTaskState(task(TODAY), TODAY, NOW)).toMatchObject({ overdue: false, label: '今天到期', tone: 'orange' })
    expect(maintenanceTaskState(task('2026-09-23'), TODAY, NOW)).toMatchObject({ overdue: false, label: '还剩 3 天' })
  })

  it('执行时刻的本地日键：跨 UTC 日也算在本地的当天', () => {
    // 东八区 09:00 存成 UTC 是 01:00，直接切 ISO 前 10 位还是同一天；凌晨 02:00 则会差一天
    expect(maintenancePlannedDay(new Date('2026-09-20T02:00:00').toISOString())).toBe('2026-09-20')
    expect(maintenancePlannedDay('不是时间')).toBe('')
  })
})

describe('保养台账', () => {
  const device = makeDevice({ id: 'dev_1', code: 'DEV-1' }) as Device
  const otherDevice = makeDevice({ id: 'dev_2', code: 'DEV-2', name: '倾角仪' }) as Device
  const idleDevice = makeDevice({ id: 'dev_3', code: 'DEV-3', name: '温湿度计' }) as Device

  it('只列有保养计划或保养任务的设备', () => {
    const rows = maintenanceLedger(input({ devices: [device, otherDevice, idleDevice], plans: [plan()], tasks: [doneTask('2026-09-10')] }))
    expect(rows.map((row) => row.deviceId)).toEqual(['dev_1'])
    expect(rows[0].deviceCode).toBe('DEV-1')
  })

  it('当前计划优先取启用中的那条', () => {
    const rows = maintenanceLedger(
      input({ devices: [device], plans: [plan({ id: 'p_off', code: 'MP-20260901-002', enabled: false }), plan({ id: 'p_on', code: 'MP-20260901-003', enabled: true })] }),
    )
    expect(rows[0].plan?.id).toBe('p_on')
    expect(rows[0].planCount).toBe(2)
    expect(rows[0].activePlanCount).toBe(1)
  })

  it('下次保养日期优先取最近一次执行登记的值', () => {
    const rows = maintenanceLedger(input({ devices: [device], plans: [plan()], tasks: [doneTask('2026-09-10')] }))
    expect(rows[0].nextDueDate).toBe('2026-10-20')
    expect(rows[0].nextDueSource).toBe('execution')
  })

  it('没执行过就按周期推算下一个执行日', () => {
    const monthly = plan({ cycle: { unit: 'month', interval: 1, atTime: '09:00' }, startDate: '2026-09-01' })
    const rows = maintenanceLedger(input({ devices: [device], plans: [monthly] }))
    expect(rows[0].nextDueDate).toBe('2026-10-01')
    expect(rows[0].nextDueSource).toBe('plan')
  })

  it('计划停用或窗口内没有执行日时不编日期', () => {
    const stopped = maintenanceLedger(input({ devices: [device], plans: [plan({ enabled: false })] }))
    expect(stopped[0].nextDueDate).toBeNull()
    expect(stopped[0].nextDueSource).toBe('none')
    // 结束日期已过 → 窗口内无命中，不能拿"今天"顶替
    const ended = maintenanceLedger(input({ devices: [device], plans: [plan({ endDate: '2026-09-10' })] }))
    expect(ended[0].nextDueDate).toBeNull()
    // 没有计划也没有任务：设备不进台账，也就没有"下次保养日期"这回事
    expect(maintenanceLedger(input({ devices: [device] }))).toHaveLength(0)
  })

  it('最近一次结果取时间最晚的已完成执行，含措施、材料与照片数', () => {
    const rows = maintenanceLedger(input({ devices: [device], plans: [plan()], tasks: [doneTask('2026-09-01'), doneTask('2026-09-15')] }))
    expect(rows[0].lastResult?.nextDueDate).toBe('2026-10-20')
    expect(rows[0].lastResult?.by).toBe('孙老师')
    expect(rows[0].lastResult?.measures).toContain('重新紧固固定螺栓')
    expect(rows[0].lastResult?.photoCount).toBe(2)
    expect(rows[0].lastResult?.at).toBe('2026-09-15T10:30:00.000Z')
  })

  it('历史次数按已完成条数算，待办与逾期分别计数', () => {
    const rows = maintenanceLedger(
      input({ devices: [device], plans: [plan()], tasks: [doneTask('2026-09-01'), task('2026-09-05'), task(TODAY)] }),
    )
    expect(rows[0].doneCount).toBe(1)
    expect(rows[0].taskCount).toBe(3)
    expect(rows[0].pendingCount).toBe(2)
    expect(rows[0].overdueCount).toBe(1)
    expect(rows[0].lastResult).not.toBeNull()
  })

  it('没有执行记录的行不当成保养记录，措施摘要超长截断', () => {
    const rows = maintenanceLedger(input({ devices: [device], plans: [plan()], tasks: [task('2026-09-01', { status: 'done', execution: null })] }))
    expect(rows[0].lastResult).toBeNull()
    expect(rows[0].doneCount).toBe(1)
    expect(summarizeText('重新紧固固定螺栓并清洁外壳接线端子重新压接', 8)).toBe('重新紧固固定螺栓…')
    expect(summarizeText('  短措施  ', 8)).toBe('短措施')
  })

  it('设备历史记录按执行时刻倒序，最近的在最前', () => {
    const rows = maintenanceRecordsOf([task('2026-09-01'), task('2026-09-15'), task('2026-09-10')], 'dev_1')
    expect(rows.map((row) => maintenancePlannedDay(row.plannedAt))).toEqual(['2026-09-15', '2026-09-10', '2026-09-01'])
    expect(maintenanceRecordsOf([task('2026-09-01')], 'dev_2')).toHaveLength(0)
  })

  it('计划下一次执行日推不出来时给 null，不猜日期', () => {
    expect(planNextRunDate(plan({ startDate: '2026-09-21' }), TODAY)).toBe('2026-09-21')
    expect(planNextRunDate(plan({ endDate: '2026-09-10' }), TODAY)).toBeNull()
    // 周期比窗口还长：窗口内没有命中就如实说没有
    expect(planNextRunDate(plan({ cycle: { unit: 'month', interval: 1, atTime: '09:00' }, startDate: '2026-09-01' }), TODAY, 3)).toBeNull()
  })
})

describe('四个分区', () => {
  const offline = makeDevice({ id: 'dev_9', health: 'offline' })
  const online = makeDevice({ id: 'dev_8', health: 'online' })
  const archived = makeDevice({ id: 'dev_7', health: 'offline', status: 'archived' })
  const data = input({
    plans: [plan()],
    tasks: [task('2026-09-18'), doneTask('2026-09-19')],
    devices: [offline, online, archived],
    workOrders: [order({ id: 'wo_1' }), order({ id: 'wo_2', status: 'verified' })],
    events: [makeEvent({ id: 'evt_1' }), makeEvent({ id: 'evt_2', status: 'closed' })],
  })

  it('四块各数各的：保养逾期 / 离线设备 / 未验收工单 / 未关闭事件', () => {
    const zones = maintenanceZones(data)
    expect(zones.map((row) => row.key)).toEqual(['maintenance_overdue', 'device_offline', 'work_order', 'structure_alarm'])
    expect(zones[0].count).toBe(1)
    // 已归档的离线设备不计入：不在役的设备列进"离线待排查"是个没法处理的数字
    expect(zones[1].count).toBe(1)
    expect(zones[2].count).toBe(1)
    expect(zones[3].count).toBe(1)
  })

  it('保养逾期不混进结构预警区：没有预警事件时结构预警一定是 0', () => {
    const onlyMaintenance = maintenanceZones(input({ plans: [plan()], tasks: [task('2026-09-01'), task('2026-09-02')], devices: [offline] }))
    expect(onlyMaintenance[0].count).toBe(2)
    expect(onlyMaintenance[3].count).toBe(0)
    // 反过来也一样：有预警事件也不会让"保养逾期"多一条
    const onlyEvents = maintenanceZones(input({ events: [makeEvent({ id: 'evt_1' }), makeEvent({ id: 'evt_2' })] }))
    expect(onlyEvents[0].count).toBe(0)
    expect(onlyEvents[3].count).toBe(2)
  })

  it('每块都带条数口径与点击后的去向', () => {
    const zones = maintenanceZones(data)
    for (const zone of zones) {
      expect(zone.criteria).not.toBe('')
      expect(zone.unit).not.toBe('')
    }
    expect(zones[0].target).toEqual({ kind: 'view', view: 'overdue' })
    expect(zones[1].target).toEqual({ kind: 'route', path: '/archive', query: { health: 'offline' } })
    expect(zones[2].target).toEqual({ kind: 'route', path: '/issues', query: { workOrder: 'open' } })
    expect(zones[3].target).toEqual({ kind: 'route', path: '/alarms', query: { scope: 'unclosed' } })
  })
})

describe('保养日历', () => {
  const daily = plan({ cycle: { unit: 'day', interval: 7, atTime: '09:00' }, startDate: '2026-09-01' })
  const stoppedPlan = plan({ id: 'plan_off', code: 'MP-20260901-009', enabled: false })
  const data = input({
    plans: [daily, stoppedPlan],
    tasks: [doneTask('2026-09-01'), task('2026-09-15'), task('2026-09-29')],
    devices: [makeDevice({ id: 'dev_1', code: 'DEV-1', name: '裂缝位移探头' })],
  })

  it('返回当月每一天，日期由年月推出', () => {
    const days = maintenanceCalendar(data, 2026, 9)
    expect(days).toHaveLength(30)
    expect(days[0].dayKey).toBe('2026-09-01')
    expect(days[29].dayKey).toBe('2026-09-30')
    expect(maintenanceCalendar(data, 2026, 2)).toHaveLength(28)
    expect(maintenanceCalendar(data, 2024, 2)).toHaveLength(29)
  })

  it('计划执行日按周期命中给出，停用计划不算执行日', () => {
    const days = maintenanceCalendar(data, 2026, 9)
    const hits = days.filter((row) => row.plans.length > 0).map((row) => row.dayKey)
    expect(hits).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'])
    expect(days.every((row) => row.plans.every((hit) => hit.planId !== 'plan_off'))).toBe(true)
    expect(days[0].plans[0]).toMatchObject({ code: 'MP-20260920-001', owner: '孙老师', deviceName: '裂缝位移探头' })
  })

  it('格子状态区分已完成 / 待执行 / 逾期 / 只命中计划', () => {
    const dayOf = (dayKey: string) => maintenanceCalendarDayOf(data, dayKey)
    expect(dayOf('2026-09-01').state).toBe('done')
    expect(dayOf('2026-09-15').state).toBe('overdue')
    expect(dayOf('2026-09-08').state).toBe('planned')
    expect(dayOf('2026-09-29').state).toBe('pending')
    expect(dayOf('2026-09-02').state).toBe('none')
  })

  it('某天的任务列表来自真实的执行时刻，没有任务就是空的', () => {
    expect(maintenanceTasksOnDay(data.tasks, '2026-09-15')).toHaveLength(1)
    expect(maintenanceTasksOnDay(data.tasks, '2026-09-16')).toHaveLength(0)
  })

  it('只命中计划但还没生成任务的那天，给出计划条数与设备名', () => {
    const hits = maintenanceDayPlanHits(data, '2026-09-08')
    expect(hits).toHaveLength(1)
    expect(hits[0].deviceName).toBe('裂缝位移探头')
    expect(maintenanceDayPlanHits(data, '2026-09-09')).toHaveLength(0)
    expect(maintenanceDayPlanHits(data, '不是日期')).toHaveLength(0)
  })
})

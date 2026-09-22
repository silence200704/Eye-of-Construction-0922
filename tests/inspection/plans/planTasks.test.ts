/**
 * 计划校验与任务生成测试（幂等）。
 * 口径：同一计划同一执行时刻只生成一条任务，重复点"生成今日任务"不重复建单；
 * 停用计划不再生成新任务，既有任务保留；必查点必须落在所选楼栋/楼层范围内。
 */
import { describe, expect, it } from 'vitest'
import { planTasksFor, taskKeyOf, validatePlan } from '@/core/inspection/taskPlan'
import type { InspectionPlan, InspectionTask } from '@/types/inspection'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-15T01:30:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }

const FLR_1 = makeFloor({ id: 'flr_1', buildingId: 'bld_1', name: '二层', zones: ['二层走廊'] })
const FLR_2 = makeFloor({ id: 'flr_2', buildingId: 'bld_1', name: '三层', zones: ['三层走廊'] })
const PNT_1 = makePoint({ id: 'pnt_1', code: 'B01-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })
const PNT_2 = makePoint({ id: 'pnt_2', code: 'B01-F3-TILT01', buildingId: 'bld_1', floorId: 'flr_2', zoneId: '三层走廊' })
const CTX = { buildings: [makeBuilding({ id: 'bld_1' })], floors: [FLR_1, FLR_2], points: [PNT_1, PNT_2] }

function plan(override: Partial<InspectionPlan> = {}): InspectionPlan {
  return {
    ...AUDIT,
    id: 'plan_1',
    code: 'PLAN-20260915-001',
    name: '二层走廊日巡检',
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
    enabled: true,
    remark: '',
    ...override,
  }
}

function task(override: Partial<InspectionTask> = {}): InspectionTask {
  return {
    ...AUDIT,
    id: 'task_1',
    taskNo: 'TK-20260915-001',
    planId: 'plan_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    plannedAt: '2026-09-15T01:00:00.000Z',
    dueAt: '2026-09-15T01:00:00.000Z',
    status: 'pending',
    results: [],
    issueIds: [],
    ...override,
  }
}

describe('计划归属校验', () => {
  it('必查点不在所选楼层时报错', () => {
    const out = validatePlan(plan({ pointIds: ['pnt_2'] }), CTX)
    expect(out.ok).toBe(false)
    expect(out.errors.join('；')).toContain('不在所选楼栋/楼层范围内')
  })

  it('楼层不属于该楼栋时报错', () => {
    const out = validatePlan(plan({ floorIds: ['flr_other'] }), CTX)
    expect(out.ok).toBe(false)
    expect(out.errors.join('；')).toContain('不属于该楼栋')
  })

  it('楼栋不存在时直接返回', () => {
    const out = validatePlan(plan({ buildingId: 'bld_gone' }), CTX)
    expect(out.ok).toBe(false)
    expect(out.errors).toEqual(['所属楼栋不存在'])
  })

  it('已归档的必查点不能排进新计划', () => {
    const ctx = { ...CTX, points: [{ ...PNT_1, status: 'archived' as const }, PNT_2] }
    const out = validatePlan(plan(), ctx)
    expect(out.ok).toBe(false)
    expect(out.errors.join('；')).toContain('已归档')
  })

  it('名称、开始日期、周期、楼层与必查点的空值都被拦截', () => {
    const out = validatePlan(plan({ name: '  ', startDate: '', floorIds: [], pointIds: [], cycle: { unit: 'day', interval: 0, atTime: '09:00' } }), CTX)
    expect(out.errors).toHaveLength(5)
  })

  it('归属一致的计划通过校验', () => {
    const out = validatePlan(plan({ floorIds: ['flr_1', 'flr_2'], pointIds: ['pnt_1', 'pnt_2'] }), CTX)
    expect(out.ok).toBe(true)
  })
})

describe('任务生成幂等', () => {
  const day = new Date('2026-09-15T00:00:00')

  it('按计划与周期给出当天应做的任务', () => {
    const planned = planTasksFor([plan()], day)
    expect(planned).toHaveLength(1)
    expect(planned[0].pointIds).toEqual(['pnt_1'])
    expect(planned[0].plannedAt).toBe(new Date('2026-09-15T09:00:00').toISOString())
    // 截止时刻是当天结束，不是计划时刻：上午生成的任务下午不该算逾期
    expect(new Date(planned[0].dueAt).getHours()).toBe(23)
    expect(new Date(planned[0].dueAt).getDate()).toBe(15)
  })

  it('"是否已生成"不在这里判断：去重由数据库事务负责', () => {
    const plannedAt = new Date('2026-09-15T09:00:00').toISOString()
    // 同一天无论是否已有任务，本函数都只回答"应做哪些"；真实去重见 stores 的并发测试
    expect(planTasksFor([plan()], day)).toHaveLength(1)
    expect(taskKeyOf('plan_1', plannedAt)).toBe(`plan_1@${plannedAt}`)
  })

  it('同一天不同计划的同名时刻各自生成一条', () => {
    const planned = planTasksFor([plan(), plan({ id: 'plan_2', code: 'PLAN-20260915-002' })], day)
    expect(planned.map((row) => row.plan.id)).toEqual(['plan_1', 'plan_2'])
  })

  it('停用的计划不再出现在应做列表里', () => {
    expect(planTasksFor([plan({ enabled: false })], day)).toEqual([])
  })

  it('不命中周期的那天不生成', () => {
    const weekly = plan({ cycle: { unit: 'week', interval: 1, atTime: '09:00' } })
    expect(planTasksFor([weekly], new Date('2026-09-15T00:00:00'))).toHaveLength(1)
    expect(planTasksFor([weekly], new Date('2026-09-16T00:00:00'))).toEqual([])
  })

  it('没有必查点的计划不出现在应做列表里', () => {
    expect(planTasksFor([plan({ pointIds: [] })], day)).toEqual([])
  })

  it('任务快照带出计划当时的范围与清单，之后改计划不影响它', () => {
    const planned = planTasksFor([plan({ floorIds: ['flr_1', 'flr_2'], pointIds: ['pnt_1', 'pnt_2'] })], day)
    expect(planned[0].snapshot.floorIds).toEqual(['flr_1', 'flr_2'])
    expect(planned[0].snapshot.pointIds).toEqual(['pnt_1', 'pnt_2'])
    expect(planned[0].snapshot.planCode).toBe('PLAN-20260915-001')
  })
})

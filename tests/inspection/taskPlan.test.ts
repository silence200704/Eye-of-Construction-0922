/**
 * 巡检计划 → 任务生成测试（方案 §3）。
 * 关键口径：未检查的点始终留在待检查；任务"部分完成"与"已检查"要分得清；
 * 标签不符的点不计入完成；逾期任务单独标记；必查点为空的三种原因必须分开说。
 */
import { describe, expect, it } from 'vitest'
import {
  cycleHits,
  hitDayOfMonth,
  initialResults,
  isOverdue,
  plannedAtOf,
  pointPoolHint,
  snapshotOfPlan,
  taskProgress,
  taskStatusOf,
} from '@/core/inspection/taskPlan'
import type { ChecklistItem, InspectionPlan, InspectionTask, TaskCheckResult } from '@/types/inspection'
import { makePoint } from '../fixtures'

const AT = '2026-09-15T01:30:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }

const PLAN: InspectionPlan = {
  ...AUDIT,
  id: 'plan_1',
  code: 'PLAN-20260915-001',
  name: '二层走廊周巡检',
  kind: 'patrol',
  buildingId: 'bld_1',
  floorIds: ['flr_1'],
  pointIds: ['pnt_1', 'pnt_2', 'pnt_3'],
  cycle: { unit: 'week', interval: 1, atTime: '09:00' },
  startDate: '2026-09-01',
  endDate: null,
  owner: '李老师',
  executorRole: 'inspector',
  checklist: [],
  remark: '',
}

const CHECKLIST: ChecklistItem[] = [
  { key: 'surface', label: '外观是否完好', required: true, hint: '' },
  { key: 'fixing', label: '固定是否牢靠', required: true, hint: '' },
]

describe('周期命中与计划时刻', () => {
  it('按周计划在起始日与每 7 天命中', () => {
    const start = new Date('2026-09-01T00:00:00')
    expect(cycleHits(PLAN.cycle, start, new Date('2026-09-01T00:00:00'))).toBe(true)
    expect(cycleHits(PLAN.cycle, start, new Date('2026-09-08T00:00:00'))).toBe(true)
    expect(cycleHits(PLAN.cycle, start, new Date('2026-09-02T00:00:00'))).toBe(false)
  })

  it('起始日之前不生成任务', () => {
    const start = new Date('2026-09-10T00:00:00')
    const plan = { ...PLAN, startDate: '2026-09-10' }
    expect(cycleHits(plan.cycle, start, new Date('2026-09-03T00:00:00'))).toBe(false)
    expect(plannedAtOf(plan, new Date('2026-09-03T00:00:00'))).toBeNull()
  })

  it('计划时刻取当天的执行时刻', () => {
    const at = plannedAtOf(PLAN, new Date('2026-09-15T00:00:00'))
    expect(at?.getHours()).toBe(9)
    expect(at?.getDate()).toBe(15)
  })

  it('月度计划起始日为 31 日时，在没有 31 日的月份落到当月最后一天', () => {
    const cycle = { unit: 'month' as const, interval: 1, atTime: '09:00' }
    const start = new Date('2026-01-31T00:00:00')
    const plan = { ...PLAN, cycle, startDate: '2026-01-31' }
    expect(plannedAtOf(plan, new Date('2026-01-31T00:00:00'))?.getDate()).toBe(31)
    // 2 月没有 31 日：落到 28 日而不是整月不生成
    expect(plannedAtOf(plan, new Date('2026-02-28T00:00:00'))?.getDate()).toBe(28)
    expect(plannedAtOf(plan, new Date('2026-02-27T00:00:00'))).toBeNull()
    // 4 月 30 天：落到 30 日
    expect(plannedAtOf(plan, new Date('2026-04-30T00:00:00'))?.getDate()).toBe(30)
    expect(hitDayOfMonth(31, new Date('2026-02-10T00:00:00'))).toBe(28)
    expect(hitDayOfMonth(31, new Date('2028-02-10T00:00:00'))).toBe(29)
  })

  it('起始日在月内的计划保持同日命中', () => {
    const cycle = { unit: 'month' as const, interval: 1, atTime: '09:00' }
    const plan = { ...PLAN, cycle, startDate: '2026-01-15' }
    expect(plannedAtOf(plan, new Date('2026-02-15T00:00:00'))?.getDate()).toBe(15)
    expect(plannedAtOf(plan, new Date('2026-02-16T00:00:00'))).toBeNull()
  })

  it('结束日期之后不再生成', () => {
    const plan = { ...PLAN, endDate: '2026-09-10' }
    expect(plannedAtOf(plan, new Date('2026-09-15T00:00:00'))).toBeNull()
    expect(plannedAtOf(plan, new Date('2026-09-08T00:00:00'))).not.toBeNull()
  })
})

describe('任务初始状态与整体状态', () => {
  it('新建任务时每个必查点都是待检查，清单项结果为空', () => {
    const results = initialResults(snapshotOfPlan({ ...PLAN, checklist: CHECKLIST }))
    expect(results.map((row) => row.pointId)).toEqual(['pnt_1', 'pnt_2', 'pnt_3'])
    expect(results.every((row) => row.status === 'pending')).toBe(true)
    expect(results[0].checklist.map((row) => row.result)).toEqual([null, null])
  })

  function result(pointId: string, status: TaskCheckResult['status']): TaskCheckResult {
    return { ...initialResults(snapshotOfPlan({ ...PLAN, checklist: [] }))[0], pointId, status }
  }

  it('一个点都没到 → 待检查；全到 → 已检查；部分到 → 部分完成', () => {
    expect(taskStatusOf([result('pnt_1', 'pending'), result('pnt_2', 'pending')])).toBe('pending')
    expect(taskStatusOf([result('pnt_1', 'completed'), result('pnt_2', 'completed')])).toBe('checked')
    expect(taskStatusOf([result('pnt_1', 'completed'), result('pnt_2', 'pending')])).toBe('partial')
  })

  it('标签不符的点不计入完成（只有到点才算）', () => {
    const results = [result('pnt_1', 'completed'), result('pnt_2', 'label_failed'), result('pnt_3', 'label_failed')]
    expect(taskStatusOf(results)).toBe('partial')
    expect(taskProgress(results)).toEqual({ completed: 1, total: 3, percent: 33 })
  })

  it('空清单不算完成', () => {
    expect(taskStatusOf([])).toBe('pending')
    expect(taskProgress([]).percent).toBe(0)
  })

  it('计划时刻已过且未完成才算逾期', () => {
    const task: InspectionTask = {
      ...AUDIT,
      id: 'task_1',
      taskNo: 'TK-20260920-001',
      planId: 'plan_1',
      buildingId: 'bld_1',
      floorId: 'flr_1',
      plannedAt: '2026-09-20T01:00:00.000Z',
      dueAt: '2026-09-20T09:00:00.000Z',
      status: 'partial',
      results: [result('pnt_1', 'completed'), result('pnt_2', 'pending')],
      issueIds: [],
    }
    expect(isOverdue(task, new Date('2026-09-20T10:00:00.000Z'))).toBe(true)
    expect(isOverdue({ ...task, status: 'checked' }, new Date('2026-09-20T10:00:00.000Z'))).toBe(false)
    expect(isOverdue(task, new Date('2026-09-20T08:00:00.000Z'))).toBe(false)
  })
})

/**
 * 必查点为空时的说明。
 *
 * 回归来源：楼层已勾选、但该楼层下没有在册测点时，页面仍显示"先勾选楼层，再选必查点"，
 * 用户以为点不动，实际是没得选 —— 现场因此卡在"建不了巡检计划"。
 */
describe('必查点空态说明', () => {
  const floorNames: Record<string, string> = { flr_1: '一层', flr_2: '二层', flr_3: '三层' }
  const floorNameOf = (floorId: string): string => floorNames[floorId] ?? floorId
  const buildingFloorIds = new Set(['flr_1', 'flr_2', 'flr_3'])
  const pointAt = (id: string, code: string, floorId: string) => makePoint({ id, code, floorId })

  it('未勾选楼层时提示先勾选楼层', () => {
    const hint = pointPoolHint({ selectedFloorIds: [], buildingPoints: [], buildingFloorIds, floorNameOf })
    expect(hint).toBe('先勾选楼层，再选必查点')
  })

  it('所选楼层没有测点、但本楼栋其他楼层有：指出测点在哪几层', () => {
    const hint = pointPoolHint({
      selectedFloorIds: ['flr_3'],
      buildingPoints: [pointAt('pnt_1', 'B03-F1-CHECK01', 'flr_1'), pointAt('pnt_2', 'B03-F2-CRACK01', 'flr_2')],
      buildingFloorIds,
      floorNameOf,
    })
    expect(hint).toContain('所选楼层下没有在册测点')
    expect(hint).toContain('一层、二层')
    expect(hint).not.toContain('先勾选楼层')
  })

  it('本楼栋还没有测点档案：指引去建档', () => {
    const hint = pointPoolHint({ selectedFloorIds: ['flr_1'], buildingPoints: [], buildingFloorIds, floorNameOf })
    expect(hint).toContain('还没有测点档案')
    expect(hint).toContain('建筑与设备')
  })

  it('测点指向的楼层已不存在：点名测点编号并指向一致性检查', () => {
    const hint = pointPoolHint({
      selectedFloorIds: ['flr_1'],
      buildingPoints: [pointAt('pnt_1', 'B01-F1-CHECK01', 'flr_已删除')],
      buildingFloorIds,
      floorNameOf,
    })
    expect(hint).toContain('楼层引用已失效')
    expect(hint).toContain('B01-F1-CHECK01')
    expect(hint).toContain('数据一致性检查')
  })

  it('所选楼层里有测点时返回空串（页面据此不渲染说明）', () => {
    const hint = pointPoolHint({
      selectedFloorIds: ['flr_1'],
      buildingPoints: [pointAt('pnt_1', 'B01-F1-CHECK01', 'flr_1')],
      buildingFloorIds,
      floorNameOf,
    })
    expect(hint).toBe('')
  })
})

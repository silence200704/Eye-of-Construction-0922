/**
 * 三项管理指标的口径测试（V1-E）。
 *
 * 重点不是"算出来是多少"，而是**口径不出错**：
 * 拿不到判定依据的对象不得硬算（进"不纳入"清单），分母为 0 时必须返回"暂无数据"而不是 0% 或 100%。
 */
import { describe, expect, it } from 'vitest'
import { allIndicators, issueClosureRate, periodicCompletionRate, rangeOf, responseDuration } from '@/core/metrics/indicators'
import { makeEvent } from '../fixtures'
import type { ChecklistAnswer, InspectionIssue, RecheckRound } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'

const AUDIT = { createdAt: '2026-09-10T01:00:00.000Z', createdBy: '测试', updatedAt: '2026-09-10T01:00:00.000Z', updatedBy: '测试' }

function round(overrides: Partial<RecheckRound> = {}): RecheckRound {
  return {
    subject: '复测裂缝宽度',
    owner: '李老师',
    dueDate: '2026-09-20',
    at: '2026-09-15T01:00:00.000Z',
    by: '张工',
    outcome: null,
    outcomeAt: null,
    outcomeBy: '',
    outcomeNote: '',
    ...overrides,
  }
}

function issue(overrides: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    ...AUDIT,
    id: 'iss_1',
    issueNo: 'ISS-20260910-001',
    source: 'report',
    submissionKey: 'sk_1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    eventId: null,
    taskId: null,
    anomalyType: '裂缝扩展',
    description: '墙面裂缝',
    photos: [],
    status: 'pending_review',
    reviewAction: null,
    reviewCategory: '',
    reviewedAt: null,
    reviewedBy: '',
    reviewNote: '',
    duplicateOf: null,
    linkedEventId: null,
    linkedFrom: [],
    workOrderIds: [],
    rechecks: [],
    timeline: [],
    ...overrides,
  }
}

function task(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    ...AUDIT,
    id: 'plan_m1@2026-09-18T01:00:00.000Z',
    taskNo: 'MT-20260918-001',
    planId: 'plan_m1',
    deviceId: 'dev_1',
    plannedAt: '2026-09-18T01:00:00.000Z',
    dueAt: '2026-09-18T15:59:59.000Z',
    status: 'pending',
    snapshot: {
      planCode: 'MP-20260901-001',
      planName: '裂缝传感器月度保养',
      deviceCode: 'B03-F2-CRACK01-DEV1',
      deviceName: '裂缝位移探头',
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      floorId: 'flr_1',
      zoneId: '二层走廊',
      owner: '王师傅',
      cycle: { unit: 'month', interval: 1, atTime: '09:00' },
      checklist: [],
    },
    execution: null,
    timeline: [],
    ...overrides,
  }
}

const BASE = {
  events: [],
  issues: [],
  maintenanceTasks: [],
  workOrders: [],
  buildingOfPoint: { pnt_1: 'bld_1', pnt_2: 'bld_2' },
  range: null,
  buildingId: null,
}

describe('指标一：预警响应时长', () => {
  it('未响应事件不进分母，并出现在不纳入清单里', () => {
    const input = {
      ...BASE,
      events: [
        makeEvent({ id: 'evt_1', eventNo: 'E-1', openedAt: '2026-09-20T00:00:00.000Z', acknowledgedAt: '2026-09-20T02:00:00.000Z' }),
        makeEvent({ id: 'evt_2', eventNo: 'E-2', pointId: 'pnt_2', openedAt: '2026-09-20T00:00:00.000Z' }),
      ],
    }
    const out = responseDuration(input)
    expect(out.denominator.value).toBe(1)
    expect(out.numerator.value).toBe(2)
    expect(out.value).toBe(2)
    expect(out.exclusions[0].count).toBe(1)
    expect(out.exclusions[0].samples).toEqual(['E-2'])
  })

  it('确认与转问题取更早的那个时刻，避免把响应时长算长', () => {
    const input = {
      ...BASE,
      events: [makeEvent({ id: 'evt_1', eventNo: 'E-1', openedAt: '2026-09-20T00:00:00.000Z', acknowledgedAt: '2026-09-20T05:00:00.000Z' })],
      issues: [issue({ eventId: 'evt_1', createdAt: '2026-09-20T01:00:00.000Z' })],
    }
    const out = responseDuration(input)
    expect(out.value).toBe(1)
    expect(out.extra).toContain('中位数 1.0 小时')
  })

  it('时间范围与楼栋筛选同时生效', () => {
    const events = [
      makeEvent({ id: 'evt_1', eventNo: 'E-1', openedAt: '2026-09-01T00:00:00.000Z', acknowledgedAt: '2026-09-01T01:00:00.000Z' }),
      makeEvent({ id: 'evt_2', eventNo: 'E-2', pointId: 'pnt_2', openedAt: '2026-09-20T00:00:00.000Z', acknowledgedAt: '2026-09-20T03:00:00.000Z' }),
    ]
    expect(responseDuration({ ...BASE, events, range: { from: '2026-09-15', to: '2026-09-22' } }).denominator.value).toBe(1)
    expect(responseDuration({ ...BASE, events, buildingId: 'bld_1' }).numerator.value).toBe(1)
  })
})

describe('指标二：问题按期闭环率', () => {
  it('按期与逾期分别计数，未登记复查的问题既不进分子也不进分母', () => {
    const input = {
      ...BASE,
      issues: [
        issue({
          id: 'iss_ok',
          issueNo: 'ISS-1',
          status: 'closed',
          rechecks: [round({ outcome: 'recovered', outcomeAt: '2026-09-19T01:00:00.000Z' })],
          timeline: [{ at: '2026-09-19T02:00:00.000Z', by: '张工', byRole: '学校安全管理人员', action: '关闭问题', detail: '' }],
        }),
        issue({
          id: 'iss_late',
          issueNo: 'ISS-2',
          status: 'closed',
          rechecks: [round({ outcome: 'recovered', outcomeAt: '2026-09-22T01:00:00.000Z' })],
          timeline: [{ at: '2026-09-22T02:00:00.000Z', by: '张工', byRole: '学校安全管理人员', action: '关闭问题', detail: '' }],
        }),
        issue({
          id: 'iss_noround',
          issueNo: 'ISS-3',
          status: 'closed',
          reviewCategory: 'no_fault',
          timeline: [{ at: '2026-09-18T02:00:00.000Z', by: '张工', byRole: '学校安全管理人员', action: '关闭问题', detail: '' }],
        }),
      ],
    }
    const out = issueClosureRate(input)
    expect(out.numerator.value).toBe(1)
    expect(out.denominator.value).toBe(2)
    expect(out.value).toBe(0.5)
    expect(out.extra).toContain('逾期关闭 1 条')
    expect(out.exclusions[0].count).toBe(1)
    expect(out.exclusions[0].samples).toEqual(['ISS-3'])
  })

  it('未关闭的问题进未闭环清单，不算入分母', () => {
    const out = issueClosureRate({ ...BASE, issues: [issue({ status: 'repairing' })] })
    expect(out.value).toBeNull()
    expect(out.denominator.value).toBe(0)
    expect(out.exclusions[1].count).toBe(1)
  })
})

describe('指标三：复查 / 保养按期完成率', () => {
  it('复查按结论时间、保养按执行日判定；未完成与未出结论的进不纳入清单', () => {
    const input = {
      ...BASE,
      issues: [
        issue({
          issueNo: 'ISS-1',
          status: 'observing',
          rechecks: [
            round({ outcome: 'observing', outcomeAt: '2026-09-19T01:00:00.000Z', dueDate: '2026-09-20' }),
            round({ dueDate: '2026-09-25' }),
          ],
        }),
      ],
      maintenanceTasks: [
        task({
          id: 't_ok',
          taskNo: 'MT-1',
          status: 'done',
          execution: {
            at: '2026-09-18T02:00:00.000Z',
            by: '王师傅',
            byRole: '物业值班人员',
            checklist: [] as ChecklistAnswer[],
            measures: '紧固',
            materials: '',
            photos: [],
            nextDueDate: '2026-10-18',
            note: '',
          },
        }),
        task({
          id: 't_late',
          taskNo: 'MT-2',
          status: 'done',
          plannedAt: '2026-09-15T01:00:00.000Z',
          dueAt: '2026-09-15T15:59:59.000Z',
          execution: {
            at: '2026-09-18T02:00:00.000Z',
            by: '王师傅',
            byRole: '物业值班人员',
            checklist: [] as ChecklistAnswer[],
            measures: '更换',
            materials: '',
            photos: [],
            nextDueDate: '2026-10-15',
            note: '',
          },
        }),
        task({ id: 't_pending', taskNo: 'MT-3', status: 'pending' }),
      ],
    }
    const out = periodicCompletionRate(input)
    expect(out.numerator.value).toBe(2)
    expect(out.denominator.value).toBe(3)
    expect(out.extra).toContain('复查 1/1')
    expect(out.extra).toContain('保养 1/2')
    expect(out.exclusions[0].count).toBe(1)
    expect(out.exclusions[1].count).toBe(1)
  })

  it('没有任何可统计对象时返回"暂无数据"而不是 0% 或 100%', () => {
    const out = allIndicators(BASE)
    expect(out.map((item) => item.value)).toEqual([null, null, null])
    expect(out[2].extra).toContain('暂无')
  })
})

describe('时间范围预设', () => {
  it('近 7 天含今天、本月从 1 号起、不限为 null', () => {
    expect(rangeOf('week', '2026-09-22')).toEqual({ from: '2026-09-16', to: '2026-09-22' })
    expect(rangeOf('month', '2026-09-22')).toEqual({ from: '2026-09-01', to: '2026-09-22' })
    expect(rangeOf('month', '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-01' })
    expect(rangeOf('all', '2026-09-22')).toBeNull()
  })
})

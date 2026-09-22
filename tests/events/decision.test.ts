/**
 * 事件决策测试：生成、去重、升级、恢复待确认，以及补录历史不被之后的记录影响。
 * 决策全部走纯函数 planEvent，可脱离数据库单独验证。
 */
import { describe, expect, it } from 'vitest'
import { assessRecord, previewRecord, snapshotOf } from '@/core/rules'
import { levelOfState, planEvent } from '@/core/event/plan'
import type { MonitorRecord } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import { crackHistory, makeEvent, makePoint, makeRecord, makeRule } from '../fixtures'

const ACTOR = { name: '演示操作员', role: '学校安全管理人员' }
const NOW = '2026-09-20T09:00:00.000Z'

/* ---------------- ③④ 事件去重、升级与证据链 ---------------- */

describe('预警事件去重与升级', () => {
  function assess(width: number, history = [] as ReturnType<typeof crackHistory>) {
    const rule = makeRule({ rateThreshold: null })
    const point = makePoint()
    const current = previewRecord({
      pointId: point.id,
      metric: 'crack_width',
      values: { width },
      baselineValues: { width: 0.5 },
      unit: 'mm',
      sampleTime: NOW,
      sampleWindow: '',
    })
    const assessment = assessRecord({
      rule,
      point,
      values: { width },
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history: [...history, current],
      at: NOW,
    })
    return { rule, point, assessment, record: makeRecord({ values: { width }, sampleTime: NOW }) }
  }

  function plan(width: number, open: AlarmEvent | undefined) {
    const { rule, assessment, record } = assess(width)
    return planEvent({
      open,
      record,
      assessment,
      snapshot: snapshotOf(rule),
      actor: ACTOR,
      at: NOW,
    })
  }

  it('首次越限生成事件，等级取命中等级', () => {
    const result = plan(0.62, undefined)
    expect(result.action).toBe('created')
    expect(result.level).toBe('yellow')
    expect(result.evidence?.triggerValue).toBeCloseTo(0.12, 6)
    expect(result.notifyLevel).toBe('yellow')
  })

  it('未越限不生成事件', () => {
    const result = plan(0.52, undefined)
    expect(result.action).toBe('none')
    expect(levelOfState('normal')).toBeNull()
  })

  it('同一点位同一规则再次越限只追加证据，不重复建单', () => {
    const first = plan(0.62, undefined)
    const open = makeEvent({ level: 'yellow', peakLevel: 'yellow', evidences: [] })
    const second = plan(0.63, open)
    expect(second.action).toBe('appended')
    expect(second.upgrade).toBeNull()
    expect(second.notifyLevel).toBeNull()
    expect(first.action).toBe('created')
  })

  it('等级升高时记录一次升级，并保留原等级证据', () => {
    const open = makeEvent({ level: 'yellow', peakLevel: 'yellow' })
    const result = plan(0.73, open)
    expect(result.action).toBe('upgraded')
    expect(result.upgrade?.from).toBe('yellow')
    expect(result.upgrade?.to).toBe('orange')
    expect(result.nextLevel).toBe('orange')
    expect(result.nextPeakLevel).toBe('orange')
    expect(result.evidence?.triggerValue).toBeCloseTo(0.23, 6)
    expect(result.notifyLevel).toBe('orange')
  })

  it('连续升级：黄 → 橙 → 红，每次都有独立升级记录', () => {
    const yellow = plan(0.62, undefined)
    const afterYellow = makeEvent({
      level: 'yellow',
      peakLevel: 'yellow',
      evidences: [yellow.evidence!],
    })
    const orange = plan(0.73, afterYellow)
    const afterOrange = makeEvent({
      level: 'orange',
      peakLevel: 'orange',
      evidences: [yellow.evidence!, orange.evidence!],
      upgrades: [orange.upgrade!],
    })
    const red = plan(0.82, afterOrange)
    expect(orange.action).toBe('upgraded')
    expect(red.action).toBe('upgraded')
    expect(red.upgrade?.from).toBe('orange')
    expect(red.upgrade?.to).toBe('red')
    // 三次证据一条不丢
    const all = [yellow.evidence!, orange.evidence!, red.evidence!]
    expect(all.map((item) => item.level)).toEqual(['yellow', 'orange', 'red'])
    expect(all.map((item) => item.triggerValue)).toEqual([0.12, 0.23, 0.32])
  })

  it('等级回落不改动历史最高等级，也不降级事件', () => {
    const open = makeEvent({ level: 'red', peakLevel: 'red' })
    const result = plan(0.6, open)
    expect(result.action).toBe('appended')
    expect(result.nextLevel).toBe('red')
    expect(result.nextPeakLevel).toBe('red')
  })

  it('数据转为恢复待确认时只改状态，不关闭事件，也不产生升级', () => {
    const open = makeEvent({ level: 'orange', peakLevel: 'orange' })
    const rule = makeRule()
    const point = makePoint()
    const history = [
      ...crackHistory([
        { at: '2026-09-18T09:00:00.000Z', width: 0.54 },
        { at: '2026-09-19T09:00:00.000Z', width: 0.53 },
      ]),
      previewRecord({
        pointId: point.id,
        metric: 'crack_width',
        values: { width: 0.53 },
        baselineValues: { width: 0.5 },
        unit: 'mm',
        sampleTime: NOW,
        sampleWindow: '',
      }),
    ]
    const assessment = assessRecord({
      rule,
      point,
      values: { width: 0.53 },
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history,
      at: NOW,
    })
    expect(assessment.state).toBe('recovering')
    const result = planEvent({
      open,
      record: makeRecord({ values: { width: 0.53 }, sampleTime: NOW }),
      assessment,
      snapshot: snapshotOf(rule),
      actor: ACTOR,
      at: NOW,
    })
    expect(result.action).toBe('recovering')
    expect(result.evidence).toBeNull()
    expect(result.upgrade).toBeNull()
  })

  it('没有未关闭事件时，恢复待确认不产生任何动作', () => {
    const rule = makeRule()
    const point = makePoint()
    const history = [
      ...crackHistory([
        { at: '2026-09-18T09:00:00.000Z', width: 0.54 },
        { at: '2026-09-19T09:00:00.000Z', width: 0.53 },
      ]),
      previewRecord({
        pointId: point.id,
        metric: 'crack_width',
        values: { width: 0.53 },
        baselineValues: { width: 0.5 },
        unit: 'mm',
        sampleTime: NOW,
        sampleWindow: '',
      }),
    ]
    const assessment = assessRecord({
      rule,
      point,
      values: { width: 0.53 },
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history,
      at: NOW,
    })
    const result = planEvent({
      open: undefined,
      record: makeRecord({ values: { width: 0.53 }, sampleTime: NOW }),
      assessment,
      snapshot: snapshotOf(rule),
      actor: ACTOR,
      at: NOW,
    })
    expect(result.action).toBe('none')
  })
})

describe('补录历史数据时不被之后的记录影响', () => {
  /** 与 assessPoint 相同的取历史口径：只看采样时间不晚于当前这条的记录。 */
  function truncate(history: MonitorRecord[], at: string) {
    return history.filter((row) => row.sampleTime <= at)
  }

  // 之后才录入的三条复测记录，都低于恢复阈值
  const later = crackHistory([
    { at: '2026-09-18T09:00:00.000Z', width: 0.54 },
    { at: '2026-09-19T09:00:00.000Z', width: 0.53 },
    { at: '2026-09-20T09:00:00.000Z', width: 0.53 },
  ])
  const backfillAt = '2026-09-15T09:00:00.000Z'

  function assessBackfill(width: number, history: MonitorRecord[]) {
    const rule = makeRule()
    const point = makePoint()
    const current = previewRecord({
      pointId: point.id,
      metric: 'crack_width',
      values: { width },
      baselineValues: { width: 0.5 },
      unit: 'mm',
      sampleTime: backfillAt,
      sampleWindow: '',
    })
    return assessRecord({
      rule,
      point,
      values: { width },
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history: [...history, current],
      at: backfillAt,
    })
  }

  it('补录的旧记录不会因为之后的复测记录被判成恢复待确认', () => {
    // 补录了一条正常读数：按当时的情况只能判未越限
    const scoped = assessBackfill(0.52, truncate(later, backfillAt))
    expect(scoped.state).toBe('normal')

    // 若把之后才录入的三条复测记录算进历史，恢复判定会拿它们当"连续 3 条" —— 这正是要避免的误判
    const unscoped = assessBackfill(0.52, later)
    expect(unscoped.state).toBe('recovering')
  })

  it('截断口径按采样时间比较，等于采样时间的记录仍计入', () => {
    expect(truncate(later, '2026-09-18T09:00:00.000Z')).toHaveLength(1)
    expect(truncate(later, '2026-09-17T09:00:00.000Z')).toHaveLength(0)
    expect(truncate(later, backfillAt)).toHaveLength(0)
  })
})

/**
 * 驾驶舱三张图的口径（与卡片、异常队列、问筑瞳同源）。
 *
 * 守三件事：
 * 1. 近 7 日柱状图**按事件去重**、按生成日归集，区间外与筛选范围外的不混入；
 * 2. 阶段耗时只统计连得起来的段 —— 缺样本留空、卡住的另报，不把缺失当 0 拉低平均；
 * 3. 读数趋势只画同一指标的有效读数，阈值线来自规则（与判定共用同一条 `ruleForPoint`）。
 */
import { describe, expect, it } from 'vitest'
import { buildEventHistory, buildReadingTrend, buildStageDurations } from '@/core/chart/dashboard'
import { buildSnapshot } from '@/assistant/selectors'
import type { EventEvidence } from '@/types/events'
import { makeEvent, makePoint, makeRecord, makeWorkOrder } from '../fixtures'
import { setupHarness } from '../assistant/harness'

function evidence(recordNo: string): EventEvidence {
  return {
    recordId: `rec_${recordNo}`, recordNo, sampleTime: '2026-09-18T02:00:00.000Z', level: 'red',
    triggerValue: 0.42, baselineValue: 0.5, ruleCode: 'RULE-CRACK-001', ruleVersion: 'V1.0',
    thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 }, basis: '相对基准', reason: '越限',
    addedAt: '2026-09-18T02:00:00.000Z', addedBy: '测试', addedByRole: '测试',
  }
}

describe('近 7 日预警事件柱状图', () => {
  it('按事件去重：一条事件带 3 条证据仍只计 1 条；区间外与范围外的如实另报', async () => {
    await setupHarness({
      points: [makePoint(), makePoint({ id: 'pnt_2', code: 'B01-F2-CRACK02' })],
      events: [
        makeEvent({
          id: 'e1', eventNo: 'E20260918-001', openedAt: '2026-09-18T02:00:00.000Z',
          evidences: [evidence('R1'), evidence('R2'), evidence('R3')],
        }),
        makeEvent({ id: 'e2', eventNo: 'E20260918-002', openedAt: '2026-09-18T09:00:00.000Z', status: 'closed' }),
        makeEvent({ id: 'e3', eventNo: 'E20260910-001', openedAt: '2026-09-10T02:00:00.000Z' }),
        makeEvent({ id: 'e4', eventNo: 'E20260919-001', openedAt: '2026-09-19T02:00:00.000Z', pointId: 'pnt_2' }),
      ],
    })
    const model = buildEventHistory(buildSnapshot(), ['pnt_1'])
    expect(model.days).toHaveLength(7)
    expect(model.total).toBe(2)
    expect(model.openTotal).toBe(1)
    expect(model.outOfScope).toBe(1)
    const day = model.days.find((row) => row.key === '2026-09-18')
    expect(day?.count).toBe(2)
    expect(day?.openCount).toBe(1)
    expect(day?.eventNos).toEqual(['E20260918-002', 'E20260918-001'])
  })

  it('没有事件时给空态文案，天数仍然完整（0 是事实，不是补数）', async () => {
    await setupHarness({ events: [] })
    const model = buildEventHistory(buildSnapshot(), ['pnt_1'])
    expect(model.total).toBe(0)
    expect(model.emptyText).toBe('暂无事件')
    expect(model.days.every((row) => row.count === 0)).toBe(true)
  })

  /**
   * 回归：演示时钟停在页面载入那一刻，之后写入的数据（例如刚确认的演示指令）用的是真实时刻，
   * 比时钟晚几分钟。窗口右端只取时钟的话，这些新事件会被切掉，图表看起来"写入后不刷新"。
   */
  it('比时钟更晚写入的事件仍然计入（窗口以数据最新时刻为界）', async () => {
    await setupHarness({
      events: [
        makeEvent({ id: 'e_late', eventNo: 'E20260920-009', openedAt: '2026-09-20T12:40:00.000Z' }),
      ],
    })
    const model = buildEventHistory(buildSnapshot(), ['pnt_1'])
    expect(model.total).toBe(1)
    expect(model.openTotal).toBe(1)
    expect(model.days.at(-1)?.count).toBe(1)
  })

  /**
   * 回归（跨楼栋）：窗口右端只能按**当前筛选范围内**的时间定。
   * 用全量记录/事件定窗口的话，别的楼栋刚录一条新数据，就会把本栋这张图推进空态 ——
   * 卡片按对象计数不受影响，只有图会突然变空，很难查。
   */
  it('别的楼栋有更新的数据时，本栋筛选图的窗口不受影响', async () => {
    await setupHarness({
      points: [makePoint(), makePoint({ id: 'pnt_2', code: 'B02-F2-CRACK02', buildingId: 'bld_2' })],
      events: [
        makeEvent({ id: 'e_scope', eventNo: 'E20260915-001', openedAt: '2026-09-15T02:00:00.000Z' }),
        // 别的楼栋晚 10 天：足以把 7 日窗口整个推过本栋这条事件
        makeEvent({ id: 'e_other', eventNo: 'E20260925-001', openedAt: '2026-09-25T02:00:00.000Z', pointId: 'pnt_2' }),
      ],
      records: [
        makeRecord({ id: 'r_scope', sampleTime: '2026-09-15T02:00:00.000Z', values: { width: 0.2 } }),
        // 别的楼栋晚 40 天：足以把 30 日趋势窗口整个推过本栋这条读数
        makeRecord({ id: 'r_other', pointId: 'pnt_2', sampleTime: '2026-10-25T02:00:00.000Z', values: { width: 0.9 } }),
      ],
    })
    const snapshot = buildSnapshot()
    const events = buildEventHistory(snapshot, ['pnt_1'])
    expect(events.total).toBe(1)
    // 那条记录既在窗口外、又属于别的测点，两个口径都不计它 —— outOfScope 只报"窗口内属于别的测点"的条数
    expect(events.outOfScope).toBe(0)
    const trend = buildReadingTrend(snapshot, ['pnt_1'], 'crack_width')
    expect(trend.lines).toHaveLength(1)
    expect(trend.lines[0]?.segments.flat()).toHaveLength(1)
    expect(trend.lines[0]?.latest?.value).toBe(0.2)
  })
})

describe('处置阶段耗时', () => {
  it('四时刻齐全的工单算出各段平均，缺环节的在 pending 里报且不拉低平均', async () => {
    await setupHarness({
      events: [
        makeEvent({ id: 'evt_1', openedAt: '2026-09-15T00:00:00.000Z' }),
        makeEvent({ id: 'evt_2', eventNo: 'E20260915-002', openedAt: '2026-09-15T12:00:00.000Z' }),
      ],
      workOrders: [
        makeWorkOrder(),
        makeWorkOrder({
          id: 'wo_2', orderNo: 'WO-20260916-002', eventId: null, status: 'submitted',
          assignedAt: '2026-09-16T02:00:00.000Z', submittedAt: '2026-09-16T04:00:00.000Z', reviews: [],
        }),
        makeWorkOrder({
          id: 'wo_3', orderNo: 'WO-20260916-003', eventId: 'evt_2', status: 'created',
          assignedAt: null, submittedAt: null, reviews: [],
        }),
      ],
    })
    const model = buildStageDurations(buildSnapshot(), ['pnt_1'])
    expect(model.total).toBe(3)
    expect(model.pending).toEqual({ assign: 1, submit: 0, review: 1 })
    const [open, assign, review] = model.stages
    expect(open.hours).toBe(26)
    expect(open.count).toBe(1)
    expect(assign.hours).toBe(3)
    expect(assign.count).toBe(2)
    expect(review.hours).toBe(4)
    expect(review.count).toBe(1)
  })

  it('没有可用样本时留空（null），不按 0 小时计；范围外的工单不参与', async () => {
    await setupHarness({
      workOrders: [makeWorkOrder({ assignedAt: null, submittedAt: null, reviews: [], status: 'created' })],
    })
    const snapshot = buildSnapshot()
    const model = buildStageDurations(snapshot, ['pnt_1'])
    expect(model.stages.map((row) => row.hours)).toEqual([null, null, null])
    expect(model.pending).toEqual({ assign: 1, submit: 0, review: 0 })
    expect(buildStageDurations(snapshot, ['pnt_other']).total).toBe(0)
  })
})

describe('读数趋势与阈值线', () => {
  it('只画同一指标的有效读数：存疑读数被排除并计数，其他指标测点如实另报', async () => {
    await setupHarness({
      points: [makePoint(), makePoint({ id: 'pnt_2', code: 'B01-F2-TILT01', metric: 'tilt_xy' })],
      records: [
        makeRecord({ id: 'r1', sampleTime: '2026-09-15T02:00:00.000Z', values: { width: 0.12 } }),
        makeRecord({ id: 'r2', recordNo: 'R20260916-001', sampleTime: '2026-09-16T02:00:00.000Z', values: { width: 0.15 }, quality: 'suspect' }),
      ],
    })
    const model = buildReadingTrend(buildSnapshot(), ['pnt_1', 'pnt_2'], 'crack_width')
    expect(model.metric).toBe('crack_width')
    expect(model.unit).toBe('mm')
    expect(model.lines).toHaveLength(1)
    expect(model.lines[0]?.segments.flat()).toHaveLength(1)
    expect(model.excludedReadings).toBe(1)
    expect(model.otherMetricPoints).toBe(1)
    // 相对基准规则下，图上同时有规则三级线（0.1/0.2/0.3）与"基准 0.5 ＋ 阈值"的等效线 —— 与监测趋势页同一口径
    expect(model.thresholds.map((row) => row.value)).toEqual([0.1, 0.2, 0.3, 0.6, 0.7, 0.8])
  })

  it('范围里没有该指标的测点时返回空模型与空态文案', async () => {
    await setupHarness({ records: [] })
    const model = buildReadingTrend(buildSnapshot(), ['pnt_missing'], '')
    expect(model.lines).toHaveLength(0)
    expect(model.emptyText).toBe('暂无有效读数')
    expect(model.thresholds).toHaveLength(0)
  })

  it('比时钟更晚补录的读数仍然进趋势（同一窗口口径）', async () => {
    await setupHarness({
      records: [
        makeRecord({ id: 'r_late', sampleTime: '2026-09-20T12:50:00.000Z', values: { width: 0.62 } }),
      ],
    })
    const model = buildReadingTrend(buildSnapshot(), ['pnt_1'], 'crack_width')
    expect(model.lines[0]?.segments.flat()).toHaveLength(1)
    expect(model.lines[0]?.latest?.value).toBe(0.62)
  })

  /**
   * 回归（边界）：定锚只认**有效**读数。
   * 一条很晚的无效记录若也参与定锚，窗口右端会被推到它身上，
   * 较早的有效曲线整段掉出 30 日窗口 —— 曲线突然变空，而输入数据一条没变。
   * 窗口与画点必须是同一口径（quality === 'valid'）。
   */
  it('同一测点有很晚的无效记录时，较早的有效曲线不被推出窗口', async () => {
    await setupHarness({
      records: [
        makeRecord({ id: 'r_valid', sampleTime: '2026-09-10T02:00:00.000Z', values: { width: 0.62 } }),
        // 无效记录晚了 70 天：若参与定锚，30 日窗口右端会落到它上面，把上面那条有效读数挤出去
        makeRecord({
          id: 'r_late_invalid', recordNo: 'R20260921-001', sampleTime: '2026-11-20T02:00:00.000Z',
          values: { width: 0.9 }, quality: 'invalid',
        }),
      ],
    })
    const model = buildReadingTrend(buildSnapshot(), ['pnt_1'], 'crack_width')
    expect(model.lines).toHaveLength(1)
    expect(model.lines[0]?.segments.flat()).toHaveLength(1)
    expect(model.lines[0]?.latest?.value).toBe(0.62)
    // 无效记录落在窗口之外，因此不算"窗口内被排除的读数"（它压根没进窗口）
    expect(model.excludedReadings).toBe(0)
  })
})

describe('快照的工单投影', () => {
  it('reviewedAt 取首次验收结论时刻，看板与问答共用同一行', async () => {
    await setupHarness({ workOrders: [makeWorkOrder()] })
    const rows = buildSnapshot().workOrders
    expect(rows).toHaveLength(1)
    expect(rows[0]?.orderNo).toBe('WO-20260916-001')
    expect(rows[0]?.reviewedAt).toBe('2026-09-16T10:00:00.000Z')
  })
})

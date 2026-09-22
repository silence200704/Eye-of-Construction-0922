/**
 * 趋势图上的事件与修订展示测试。
 * ① 事件节点映射：命中事件的数据点带出事件编号、等级与是否升级；
 * ② 已替代记录：被修订替代的记录单独成组，不混入有效曲线。
 */
import { describe, expect, it } from 'vitest'
import type { AlarmEvent } from '@/types/events'
import { makeEvent, makeRecord } from '../fixtures'
import { evidence, trend } from './helpers'

/* ---------------- ③ 事件节点映射 ---------------- */

describe('事件节点映射', () => {
  const events: AlarmEvent[] = [
    makeEvent({
      id: 'e1',
      eventNo: 'E1',
      level: 'orange',
      peakLevel: 'orange',
      evidences: [
        evidence('r2', 'R2', 'yellow'),
        evidence('r3', 'R3', 'orange'),
      ],
      upgrades: [
        {
          at: '2026-09-17T09:00:00.000Z',
          by: '测试',
          byRole: '学校安全管理人员',
          from: 'yellow',
          to: 'orange',
          recordNo: 'R3',
          triggerValue: 0.23,
          ruleVersion: 'V1.0',
        },
      ],
    }),
  ]
  const records = [
    makeRecord({ id: 'r1', recordNo: 'R1', sampleTime: '2026-09-15T09:00:00.000Z', values: { width: 0.52 } }),
    makeRecord({ id: 'r2', recordNo: 'R2', sampleTime: '2026-09-16T09:00:00.000Z', values: { width: 0.62 } }),
    makeRecord({ id: 'r3', recordNo: 'R3', sampleTime: '2026-09-17T09:00:00.000Z', values: { width: 0.73 } }),
  ]

  it('命中事件的记录带上事件编号与等级，未命中的不显示事件', () => {
    const series = trend({ records, events })
    const byNo = new Map(series.points.map((row) => [row.recordNo, row]))
    expect(byNo.get('R1')?.eventId).toBeNull()
    expect(byNo.get('R2')?.eventNo).toBe('E1')
    expect(byNo.get('R2')?.eventLevel).toBe('yellow')
    expect(byNo.get('R3')?.eventLevel).toBe('orange')
  })

  it('只有触发升级的那条记录标记为升级', () => {
    const series = trend({ records, events })
    const byNo = new Map(series.points.map((row) => [row.recordNo, row]))
    expect(byNo.get('R1')?.upgraded).toBe(false)
    expect(byNo.get('R2')?.upgraded).toBe(false)
    expect(byNo.get('R3')?.upgraded).toBe(true)
  })

  it('节点等级与事件证据等级一致，不在图表层重算', () => {
    const series = trend({ records, events })
    const r2 = series.points.find((row) => row.recordNo === 'R2')
    expect(r2?.eventLevel).toBe('yellow')
  })

  it('点的数值分级与列表口径一致', () => {
    const series = trend({ records })
    expect(series.points.map((row) => row.state)).toEqual(['normal', 'yellow', 'orange'])
  })
})

/* ---------------- ④ 已替代记录 ---------------- */

describe('已被修订替代的记录不混入有效曲线', () => {
  const events: AlarmEvent[] = [
    makeEvent({
      id: 'e1',
      eventNo: 'E1',
      evidences: [evidence('r2', 'R2', 'yellow')],
      supersededEvidences: [
        {
          evidence: evidence('r3', 'R3', 'red'),
          supersededAt: '2026-09-18T09:00:00.000Z',
          supersededBy: '测试',
          reason: '原记录读数填写有误',
        },
      ],
    }),
  ]
  const records = [
    makeRecord({ id: 'r1', recordNo: 'R1', sampleTime: '2026-09-15T09:00:00.000Z', values: { width: 0.52 } }),
    makeRecord({ id: 'r2', recordNo: 'R2', sampleTime: '2026-09-16T09:00:00.000Z', values: { width: 0.62 } }),
    makeRecord({ id: 'r3', recordNo: 'R3', sampleTime: '2026-09-17T09:00:00.000Z', values: { width: 0.52 }, revision: 1 }),
  ]

  it('被替代的记录单独成组，不在有效点里', () => {
    const series = trend({ records, events })
    expect(series.points.map((row) => row.recordNo)).toEqual(['R1', 'R2'])
    expect(series.supersededPoints.map((row) => row.recordNo)).toEqual(['R3'])
  })

  it('已替代点也带修订次数，便于在图上说明它被改过', () => {
    const series = trend({ records, events })
    expect(series.supersededPoints[0].revision).toBe(1)
  })

  it('没有已替代证据时分组为空', () => {
    const series = trend({ records, events: [] })
    expect(series.supersededPoints).toEqual([])
    expect(series.points).toHaveLength(3)
  })
})

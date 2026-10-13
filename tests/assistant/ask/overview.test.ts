/**
 * 问筑瞳 · 全校概况与未处理队列。
 *
 * 概况的每个数字都必须能在当前数据集里对上；事件计数按事件 ID 去重，
 * 升级过的事件不重复计数。空数据集要照实说空，不能拿预置数字顶上。
 */
import { describe, expect, it } from 'vitest'
import { makeBuilding, makeEvent, makeFloor, makePoint } from '../../fixtures'
import { claims, record, setupHarness } from '../harness'

function twoBuildings() {
  return {
    buildings: [
      makeBuilding({ id: 'bld_b01', code: 'B01', name: '1号综合楼' }),
      makeBuilding({ id: 'bld_b03', code: 'B03', name: '3号教学楼' }),
    ],
    floors: [makeFloor({ id: 'flr_b01', buildingId: 'bld_b01' }), makeFloor({ id: 'flr_b03', buildingId: 'bld_b03' })],
    points: [
      makePoint({ id: 'pnt_k1', code: 'B01-F2-CRACK01', name: '二层走廊西墙裂缝测点', buildingId: 'bld_b01', floorId: 'flr_b01' }),
      makePoint({ id: 'pnt_t3', code: 'B03-F2-TILT01', name: '二层走廊中柱倾角测点', buildingId: 'bld_b03', floorId: 'flr_b03', metric: 'tilt_xy', type: 'tilt' }),
      makePoint({ id: 'pnt_c3', code: 'B03-F1-CHECK01', name: '一层走廊人工检查点', buildingId: 'bld_b03', floorId: 'flr_b03', metric: 'inspection', type: 'manual_check' }),
    ],
    devices: [],
  }
}

describe('全校现在监测如何', () => {
  it('计数与当前数据集一致：在册、传感器、人工检查点、来源构成', async () => {
    const h = await setupHarness({
      ...twoBuildings(),
      records: [
        record({ id: 'r1', recordNo: 'R20260920-001', pointId: 'pnt_k1', sampleTime: '2026-09-20T11:00:00.000Z', enteredAt: '2026-09-20T11:05:00.000Z' }),
        record({ id: 'r2', recordNo: 'R20260920-002', pointId: 'pnt_k1', sampleTime: '2026-09-20T10:00:00.000Z', enteredAt: '2026-09-20T11:40:00.000Z', source: 'csv' }),
        record({ id: 'r3', recordNo: 'R20260920-003', pointId: 'pnt_k1', sampleTime: '2026-09-20T09:00:00.000Z', enteredAt: '2026-09-20T09:05:00.000Z', source: 'device' }),
      ],
    })

    const result = await h.ask('全校现在监测如何')
    const facts = result.facts.map((row) => `${row.label}=${row.value}${row.unit}`).join('\n')

    expect(result.status).toBe('answered')
    expect(facts).toContain('在册楼栋=2栋')
    expect(facts).toContain('在册测点=3个')
    expect(facts).toContain('其中传感器测点=2个')
    expect(facts).toContain('其中人工检查点=1个')
    // 只有一个传感器测点有有效读数
    expect(facts).toContain('有有效读数的传感器测点=1 / 2个')
    expect(facts).toContain('人工录入 1｜CSV 导入 1｜传感器数据（演示）1')
    // 有测点没有有效读数时明说不能拿"正常"顶上
    expect(result.gaps.join('\n')).toContain('不能用"正常"填充')
    // 时间口径：采样时间与录入时间各取最新，两者不是同一条
    expect(facts).toContain('最近一次采样时间=2026-09-20 19:00')
    expect(facts).toContain('最近一次录入时间=2026-09-20 19:40')
    // timing 是"最新那条记录"的一对时间，所以录入时间是它自己的 11:05
    expect(result.timing?.sampleTime).toBe('2026-09-20T11:00:00.000Z')
    expect(result.timing?.enteredAt).toBe('2026-09-20T11:05:00.000Z')
  })

  it('未关闭预警按等级计数，事件 ID 去重', async () => {
    const h = await setupHarness({
      ...twoBuildings(),
      events: [
        makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red', pointId: 'pnt_k1' }),
        makeEvent({ id: 'e2', eventNo: 'E20260920-002', level: 'yellow', peakLevel: 'orange', pointId: 'pnt_t3' }),
        makeEvent({ id: 'e3', eventNo: 'E20260920-003', level: 'red', peakLevel: 'red', status: 'closed', pointId: 'pnt_k1' }),
      ],
    })

    const result = await h.ask('全校现在监测如何')
    const facts = result.facts.map((row) => `${row.label}=${row.value}${row.unit}`).join('\n')

    expect(facts).toContain('未关闭预警合计=2条')
    expect(facts).toContain('未关闭红色=1条')
    expect(facts).toContain('未关闭黄色=1条')
    // 已关闭事件不计入
    expect(facts).toContain('未关闭橙色=0条')
    expect(result.conclusion).toContain('未关闭预警 2 条')
    expect(result.links.some((row) => row.kind === 'alarm_queue')).toBe(true)
  })

  it('一条记录都没有时不折算成"正常"', async () => {
    const h = await setupHarness(twoBuildings())
    const result = await h.ask('全校现在监测如何')
    expect(claims(result)).not.toContain('正常')
    expect(result.gaps.join('\n')).toContain('还没有任何监测记录')
    expect(result.gaps.join('\n')).toContain('尚未产生')
  })

  it('空数据集照实说空', async () => {
    const h = await setupHarness({ buildings: [], floors: [], points: [], devices: [], baselines: [], rules: [], records: [], events: [] })
    const result = await h.ask('全校现在监测如何')
    expect(result.status).toBe('answered')
    expect(result.conclusion).toContain('0 栋在册楼栋')
    expect(result.gaps.join('\n')).toContain('没有任何在册传感器测点')
    expect(result.links.some((row) => row.kind === 'alarm_queue')).toBe(false)
  })
})

describe('列出还没处理的预警', () => {
  it('按等级排序列队列，并给出证据记录号', async () => {
    const h = await setupHarness({
      ...twoBuildings(),
      records: [record({ id: 'r1', recordNo: 'R20260920-001', pointId: 'pnt_k1', sampleTime: '2026-09-20T11:00:00.000Z' })],
      events: [
        makeEvent({ id: 'e2', eventNo: 'E20260920-002', level: 'yellow', pointId: 'pnt_k1', lastTriggerAt: '2026-09-20T11:00:00.000Z' }),
        makeEvent({
          id: 'e1',
          eventNo: 'E20260920-001',
          level: 'red',
          pointId: 'pnt_k1',
          lastTriggerAt: '2026-09-20T10:00:00.000Z',
          evidences: [
            {
              recordId: 'r1',
              recordNo: 'R20260920-001',
              sampleTime: '2026-09-20T10:00:00.000Z',
              level: 'red',
              triggerValue: 0.32,
              baselineValue: 0.5,
              ruleCode: 'RULE-CRACK-001',
              ruleVersion: 'V1.0',
              thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
              basis: '相对基准的变化量',
              reason: '超过红色阈值',
              addedAt: '2026-09-20T10:05:00.000Z',
              addedBy: '系统',
              addedByRole: 'system',
            },
          ],
        }),
      ],
    })

    const result = await h.ask('列出还没处理的预警')

    expect(result.intent).toBe('open_events')
    expect(result.status).toBe('answered')
    expect(result.conclusion).toContain('2 条未关闭预警')
    expect(result.conclusion).toContain('红 1｜橙 0｜黄 1')
    // 红色排在黄色前面
    const rows = result.facts.filter((row) => row.label.startsWith('E2026'))
    expect(rows[0].label).toContain('E20260920-001')
    expect(result.evidence.map((row) => row.ref)).toContain('R20260920-001')
  })

  it('近义问法走同一个意图', async () => {
    const h = await setupHarness(twoBuildings())
    for (const question of ['有哪些待处理事件', '还没处理的预警有哪些', '列出未处置的告警']) {
      const result = await h.ask(question)
      expect(result.intent).toBe('open_events')
    }
  })

  it('没有未关闭事件时说明"尚未产生"而不是"已处置完毕"', async () => {
    const h = await setupHarness({ ...twoBuildings(), events: [] })
    const result = await h.ask('列出还没处理的预警')
    expect(result.conclusion).toContain('没有任何未关闭的预警事件')
    expect(result.gaps.join('\n')).toContain('不代表系统做过巡检')
  })

  it('超过上限时说明只列了前几条', async () => {
    // 上限是 8 条：这里给 11 条，验证多出来的部分被明说而不是静默截断
    const events = Array.from({ length: 11 }, (_, index) =>
      makeEvent({ id: `e${index}`, eventNo: `E20260920-0${10 + index}`, level: 'yellow', pointId: 'pnt_k1' }),
    )
    const h = await setupHarness({ ...twoBuildings(), events })
    const result = await h.ask('列出还没处理的预警')
    expect(result.conclusion).toContain('11 条未关闭预警')
    expect(result.gaps.join('\n')).toContain('只列出前 8 条')
  })
})

import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import { buildSamplingCoverage, buildAlertComposition, buildOrderInventory } from '@/core/chart/insights'
import { buildSnapshot } from '@/assistant/selectors'
import { insightOption } from '@/components/charts/insights/options'
import { makePoint, makeRecord, makeEvent, makeWorkOrder } from '../fixtures'
import { NOW, setupHarness } from '../assistant/harness'

describe('采样覆盖看板', () => {
  it('每测点计一次、只取最新有效记录、排除归档与人工点', async () => {
    await setupHarness({
      points: [makePoint(), makePoint({ id: 'old' }), makePoint({ id: 'missing' }),
        makePoint({ id: 'archived', status: 'archived' }), makePoint({ id: 'manual', metric: 'inspection' })],
      records: [
        makeRecord({ id: 'valid', pointId: 'pnt_1', sampleTime: NOW }),
        makeRecord({ id: 'bad', pointId: 'pnt_1', sampleTime: '2026-09-20T12:05:00.000Z', quality: 'invalid' }),
        makeRecord({ id: 'old_rec', pointId: 'old', sampleTime: '2026-09-18T12:00:00.000Z' }),
      ],
    })
    const model = buildSamplingCoverage(buildSnapshot(), ['pnt_1', 'old', 'missing', 'archived', 'manual', 'pnt_1'])
    expect(model.total).toBe(3)
    expect(model.rows.map(row => row.count)).toEqual([1, 1, 1])
    expect(model.rows[0].targets[0].id).toBe('pnt_1')
    expect(model.note).toContain('不代表设备在线')
  })

  it('最新一条存疑、旧有效超过窗口时仍计为较早采样', async () => {
    await setupHarness({ records: [
      makeRecord({ id: 'old', sampleTime: '2026-09-20T10:00:00.000Z' }),
      makeRecord({ id: 'suspect', sampleTime: NOW, quality: 'suspect' }),
    ] })
    expect(buildSamplingCoverage(buildSnapshot(), ['pnt_1']).rows.map(row => row.count)).toEqual([0, 1, 0])
  })

  it('只有无效读数时不冒充近期或正常；30分钟边界沿用现有口径', async () => {
    await setupHarness({
      points: [makePoint(), makePoint({ id: 'p2' })],
      records: [makeRecord({ id: 'invalid', quality: 'invalid', sampleTime: NOW }),
        makeRecord({ id: 'boundary', pointId: 'p2', sampleTime: '2026-09-20T11:30:00.000Z' })],
    })
    expect(buildSamplingCoverage(buildSnapshot(), ['pnt_1', 'p2']).rows.map(row => row.count)).toEqual([1, 0, 1])
  })

  it('空筛选没有百分比或虚构环片', async () => {
    await setupHarness()
    const model = buildSamplingCoverage(buildSnapshot(), [])
    expect(model.total).toBe(0)
    expect(model.rows.every(row => row.count === 0)).toBe(true)
    expect(model.empty).toContain('没有传感器')
    expect((insightOption('coverage', model).series as { data: unknown[] }[])[0].data).toEqual([])
  })

  it('store与共享时钟更新后computed重算，图表不推进时钟或写数据', async () => {
    const h = await setupHarness({ records: [makeRecord({ sampleTime: '2026-09-20T11:45:00.000Z' })] })
    const model = computed(() => buildSamplingCoverage(buildSnapshot(), ['pnt_1']))
    expect(model.value.rows[0].count).toBe(1)
    h.clock.nowKey = '2026-09-20T13:00:00.000Z'
    expect(model.value.rows[1].count).toBe(1)
    const before = JSON.stringify(buildSnapshot())
    buildSamplingCoverage(buildSnapshot(), ['pnt_1'])
    expect(JSON.stringify(buildSnapshot())).toBe(before)
  })
})

describe('预警类型与等级看板', () => {
  it('重复ID、升级和证据都不增计数；已关闭、其他范围事件排除', async () => {
    await setupHarness({ points: [makePoint(), makePoint({ id: 'p2', metric: 'tilt_xy' })] })
    const s = buildSnapshot()
    s.events = [makeEvent({ id: 'e1', level: 'red' }), makeEvent({ id: 'e1', level: 'red' }),
      makeEvent({ id: 'e2', level: 'orange' }), makeEvent({ id: 'closed', status: 'closed' }),
      makeEvent({ id: 'other', pointId: 'p2', level: 'yellow' })]
    const model = buildAlertComposition(s, ['pnt_1'])
    expect(model.total).toBe(2)
    expect(model.rows[0].levels).toEqual({ yellow: 0, orange: 1, red: 1 })
    expect(model.rows[0].targets.map(row => row.id)).toEqual(['e1', 'e2'])
    expect(buildAlertComposition(s, ['p2']).total).toBe(1)
  })

  it('类别条数与等级合计一致，不用峰值等级代替当前等级', async () => {
    await setupHarness({ points: [makePoint(), makePoint({ id: 'p2', metric: 'tilt_xy' })],
      events: [makeEvent({ id: 'a', level: 'orange', peakLevel: 'red' }), makeEvent({ id: 'b', pointId: 'p2', level: 'red' })] })
    const model = buildAlertComposition(buildSnapshot(), ['pnt_1', 'p2'])
    expect(model.total).toBe(2)
    expect(model.rows.find(row => row.key === 'crack_width')?.levels).toEqual({ yellow: 0, orange: 1, red: 0 })
    expect(model.rows.reduce((sum, row) => sum + Object.values(row.levels!).reduce((a, b) => a + b, 0), 0)).toBe(2)
  })

  it('无事件说明当前无未关闭预警，不填假的正常排行', async () => {
    await setupHarness()
    const model = buildAlertComposition(buildSnapshot(), ['pnt_1'])
    expect(model.total).toBe(0)
    expect(model.empty).toBe('当前范围无未关闭预警')
    expect(model.rows[0].targets).toEqual([])
  })
})

describe('工单库存看板', () => {
  it('状态互斥、重复ID计一次，未归属和筛选外工单不混入', async () => {
    await setupHarness()
    const s = buildSnapshot()
    s.workOrders = [
      { ...makeWorkOrder({ id: 'a', pointId: 'pnt_1', status: 'created' }), reviewedAt: null },
      { ...makeWorkOrder({ id: 'a', pointId: 'pnt_1', status: 'created' }), reviewedAt: null },
      { ...makeWorkOrder({ id: 'b', pointId: 'pnt_1', status: 'verified' }), reviewedAt: NOW },
      { ...makeWorkOrder({ id: 'none', pointId: null }), reviewedAt: null },
      { ...makeWorkOrder({ id: 'outside', pointId: 'other' }), reviewedAt: null },
    ]
    const model = buildOrderInventory(s, ['pnt_1'])
    expect(model.total).toBe(2)
    expect(model.rows.map(row => row.count)).toEqual([1, 0, 0, 0, 1, 0])
    expect(model.rows[4].targets[0].id).toBe('b')
    expect(model.note).toContain('不等于问题或事件已关闭')
  })

  it('验收退回独立展示，不放进验收通过；空筛选留空', async () => {
    await setupHarness({ workOrders: [makeWorkOrder({ pointId: 'pnt_1', status: 'returned' })] })
    const model = buildOrderInventory(buildSnapshot(), ['pnt_1'])
    expect(model.rows[5].count).toBe(1)
    expect(model.rows[4].count).toBe(0)
    expect(buildOrderInventory(buildSnapshot(), []).total).toBe(0)
  })
})

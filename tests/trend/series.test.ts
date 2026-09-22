/**
 * 趋势序列与分段测试。
 * ① 时间范围只取范围内的记录（未来记录不参与）；
 * ② 基准版本分段与阈值线随基准平移；
 * ③ 规则版本按采样时间生效，阈值线只取本测点适用的规则；
 * ④ 纵轴整齐刻度；⑤ 间隔过大的时段在图上断开。
 */
import { describe, expect, it } from 'vitest'
import {
  buildBaselineSegments,
  buildRuleSegments,
  buildThresholdLines,
  splitByGap,
} from '@/core/chart/trend'
import { decimalsOf, niceTicks } from '@/core/chart/axis'
import { makeBaseline, makePoint, makeRecord, makeRule } from '../fixtures'
import { T, trend } from './helpers'

/* ---------------- ① 时间范围 ---------------- */

describe('时间范围只取范围内的记录', () => {
  const records = [
    makeRecord({ id: 'r1', recordNo: 'R1', sampleTime: '2026-09-10T09:00:00.000Z', values: { width: 0.55 } }),
    makeRecord({ id: 'r2', recordNo: 'R2', sampleTime: '2026-09-15T09:00:00.000Z', values: { width: 0.62 } }),
    makeRecord({ id: 'r3', recordNo: 'R3', sampleTime: '2026-09-25T09:00:00.000Z', values: { width: 0.73 } }),
  ]

  it('范围外的未来记录不进入序列', () => {
    const series = trend({
      records,
      from: T('2026-09-01T00:00:00.000Z'),
      to: T('2026-09-20T00:00:00.000Z'),
    })
    expect(series.points.map((row) => row.recordNo)).toEqual(['R1', 'R2'])
  })

  it('范围外的历史记录同样不进入序列', () => {
    const series = trend({
      records,
      from: T('2026-09-14T00:00:00.000Z'),
      to: T('2026-09-30T00:00:00.000Z'),
    })
    expect(series.points.map((row) => row.recordNo)).toEqual(['R2', 'R3'])
  })

  it('点按采样时间升序排列', () => {
    const series = trend({ records: [records[2], records[0], records[1]] })
    expect(series.points.map((row) => row.t)).toEqual(
      [...series.points.map((row) => row.t)].sort((a, b) => a - b),
    )
  })

  it('缺该指标的记录被跳过，不画成零', () => {
    const series = trend({
      records: [
        makeRecord({ id: 'x1', recordNo: 'X1', sampleTime: '2026-09-10T09:00:00.000Z', values: {} }),
        records[0],
      ],
    })
    expect(series.points.map((row) => row.recordNo)).toEqual(['R1'])
  })

  it('其它测点的记录不会被画进来', () => {
    const series = trend({
      records: [records[0], makeRecord({ id: 'other', pointId: 'pnt_other', values: { width: 9 } })],
    })
    expect(series.points).toHaveLength(1)
  })
})

/* ---------------- ② 基准版本分段 ---------------- */

describe('基准版本分段', () => {
  const baselines = [
    makeBaseline({ id: 'b1', version: 1, values: { width: 0.5 }, effectiveFrom: '2026-09-01T00:00:00.000Z', current: false }),
    makeBaseline({ id: 'b2', version: 2, values: { width: 0.6 }, effectiveFrom: '2026-09-15T00:00:00.000Z', current: true }),
    makeBaseline({ id: 'b3', version: 3, values: { width: 0.62 }, effectiveFrom: '2026-10-20T00:00:00.000Z', current: false }),
  ]

  it('按生效时间切成若干段，换版处就是分段点', () => {
    const segments = buildBaselineSegments(baselines, 'width', T('2026-09-01T00:00:00.000Z'), T('2026-09-30T00:00:00.000Z'))
    expect(segments).toHaveLength(2)
    expect(segments[0].version).toBe(1)
    expect(segments[0].value).toBe(0.5)
    expect(segments[1].version).toBe(2)
    expect(segments[1].value).toBe(0.6)
    // 分段首尾相接，不留空隙
    expect(segments[0].toT).toBe(segments[1].fromT)
    expect(segments[1].fromT).toBe(T('2026-09-15T00:00:00.000Z'))
  })

  it('晚于查询区间的未来版本不参与分段', () => {
    const segments = buildBaselineSegments(baselines, 'width', T('2026-09-01T00:00:00.000Z'), T('2026-09-30T00:00:00.000Z'))
    expect(segments.some((row) => row.version === 3)).toBe(false)
  })

  it('区间起点之前就生效的版本照常作为第一段', () => {
    const segments = buildBaselineSegments(baselines, 'width', T('2026-09-10T00:00:00.000Z'), T('2026-09-12T00:00:00.000Z'))
    expect(segments).toHaveLength(1)
    expect(segments[0].version).toBe(1)
    expect(segments[0].fromT).toBe(T('2026-09-10T00:00:00.000Z'))
  })

  it('阈值线随基准分段平移：段内基准 + 规则阈值', () => {
    const segments = buildRuleSegments({
      rules: [makeRule()],
      baselines,
      point: makePoint(),
      key: 'width',
      from: T('2026-09-01T00:00:00.000Z'),
      to: T('2026-09-30T00:00:00.000Z'),
    })
    const lines = buildThresholdLines(segments)
    expect(lines).toHaveLength(6)
    const firstYellow = lines.find((row) => row.level === 'yellow' && row.fromT === segments[0].fromT)
    const secondYellow = lines.find((row) => row.level === 'yellow' && row.fromT === segments[1].fromT)
    expect(firstYellow?.value).toBeCloseTo(0.6, 6)
    expect(secondYellow?.value).toBeCloseTo(0.7, 6)
  })

  it('绝对判定指标的阈值线不随基准平移', () => {
    const segments = buildRuleSegments({
      rules: [makeRule({ metric: 'vibration', unit: 'm/s²', baselineSource: 'none', thresholds: { yellow: 0.05, orange: 0.1, red: 0.2 } })],
      baselines: [],
      point: makePoint({ metric: 'vibration', type: 'vibration' }),
      key: 'accelRms',
      from: T('2026-09-01T00:00:00.000Z'),
      to: T('2026-09-30T00:00:00.000Z'),
    })
    const lines = buildThresholdLines(segments)
    expect(lines.map((row) => row.value)).toEqual([0.05, 0.1, 0.2])
    expect(lines.every((row) => row.fromT === T('2026-09-01T00:00:00.000Z'))).toBe(true)
  })

  it('同一条记录按自己的采样时间取当时的基准版本', () => {
    const series = trend({
      baselines,
      records: [
        makeRecord({ id: 'r1', recordNo: 'R1', sampleTime: '2026-09-10T09:00:00.000Z', values: { width: 0.55 }, baselineValues: { width: 0.5 } }),
        makeRecord({ id: 'r2', recordNo: 'R2', sampleTime: '2026-09-20T09:00:00.000Z', values: { width: 0.7 }, baselineValues: { width: 0.6 } }),
      ],
    })
    expect(series.points.map((row) => row.baselineVersion)).toEqual([1, 2])
  })
})

/* ---------------- 规则版本按时间生效 ---------------- */

describe('规则版本按采样时间生效', () => {
  const v1 = makeRule({
    id: 'r@V1.0',
    version: 'V1.0',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
  })
  const v2 = makeRule({
    id: 'r@V2.0',
    version: 'V2.0',
    effectiveFrom: '2026-09-15T00:00:00.000Z',
    thresholds: { yellow: 0.05, orange: 0.1, red: 0.15 },
  })

  it('每条记录按自己的采样时间取当时的规则版本判定', () => {
    const series = trend({
      rules: [v1, v2],
      records: [
        makeRecord({ id: 'a', recordNo: 'A', sampleTime: '2026-09-10T09:00:00.000Z', values: { width: 0.62 } }),
        makeRecord({ id: 'b', recordNo: 'B', sampleTime: '2026-09-20T09:00:00.000Z', values: { width: 0.62 } }),
      ],
    })
    // 同一个读数：旧版阈值下是黄色，新版阈值下是橙色
    expect(series.points.map((row) => row.state)).toEqual(['yellow', 'orange'])
    expect(series.points.map((row) => row.ruleVersion)).toEqual(['V1.0', 'V2.0'])
  })

  it('规则换版处阈值线断开，并按各自版本的阈值绘制', () => {
    const series = trend({ rules: [v1, v2], records: [] })
    const yellow = series.thresholdLines.filter((row) => row.level === 'yellow')
    expect(yellow).toHaveLength(2)
    expect(yellow[0].ruleVersion).toBe('V1.0')
    expect(yellow[0].value).toBeCloseTo(0.6, 6)
    expect(yellow[1].ruleVersion).toBe('V2.0')
    expect(yellow[1].value).toBeCloseTo(0.55, 6)
  })

  it('图上列出出现过的规则版本，供页面说明换版', () => {
    const series = trend({ rules: [v1, v2], records: [] })
    expect(series.ruleVersions).toEqual(['V1.0', 'V2.0'])
  })

  it('只有一条规则时阈值线不断开', () => {
    const series = trend({ rules: [v1], records: [] })
    expect(series.thresholdLines.filter((row) => row.level === 'yellow')).toHaveLength(1)
    expect(series.ruleVersions).toEqual(['V1.0'])
  })

  it('纵轴刻度取整齐步长，让阈值落在刻度上', () => {
    // 评审问题：四等分得到的 0.45 / 0.56 / 0.66 / 0.76 / 0.87 读不出阈值在哪一档
    const axis = niceTicks(0.45, 0.87, 5)
    expect(axis.step).toBe(0.1)
    expect(axis.values).toEqual([0.5, 0.6, 0.7, 0.8])
  })

  it('刻度步长随量级变化，小数位跟着步长走', () => {
    expect(niceTicks(0, 0.2, 5).values).toEqual([0, 0.05, 0.1, 0.15, 0.2])
    expect(decimalsOf(0.05)).toBe(2)
    expect(decimalsOf(1)).toBe(0)
    expect(niceTicks(24, 27, 5).values).toEqual([24, 25, 26, 27])
  })

  it('范围退化时只给一个刻度，不产生空轴', () => {
    const axis = niceTicks(0.5, 0.5, 5)
    expect(axis.values).toEqual([0.5])
    expect(axis.step).toBe(0)
  })

  it('记录采样时间早于任何规则版本时不给分级，也不套用后来的阈值', () => {
    const series = trend({
      rules: [v2],
      records: [makeRecord({ id: 'a', recordNo: 'A', sampleTime: '2026-09-10T09:00:00.000Z', values: { width: 0.62 } })],
    })
    expect(series.points[0].state).toBeNull()
    expect(series.points[0].ruleVersion).toBeNull()
  })

  it('同表内其他指标的规则不参与本测点的阈值线', () => {
    // 页面上传的是规则全表，四类指标同一天生效；取"最后一条生效版本"会拿到别条规则的阈值
    const crack = makeRule({ id: 'crack@V1.0', effectiveFrom: '2026-09-01T00:00:00.000Z' })
    const vib = makeRule({
      id: 'vib@V1.0',
      code: 'RULE-VIB-001',
      metric: 'vibration',
      unit: 'm/s²',
      baselineSource: 'none',
      thresholds: { yellow: 0.05, orange: 0.1, red: 0.2 },
      effectiveFrom: '2026-09-01T00:00:00.000Z',
    })
    const series = trend({ rules: [crack, vib], records: [] })
    // 裂缝：基准 0.5 + 黄 0.1 / 橙 0.2 / 红 0.3
    expect(series.thresholdLines.map((row) => row.value)).toEqual([0.6, 0.7, 0.8])
  })

  it('楼栋范围不覆盖本测点所在楼栋的规则不参与分段', () => {
    const other = makeRule({
      id: 'crack@other',
      buildingIds: ['bld_other'],
      pointIds: [],
      effectiveFrom: '2026-09-20T00:00:00.000Z',
    })
    const own = makeRule({ id: 'crack@own', effectiveFrom: '2026-09-01T00:00:00.000Z' })
    const series = trend({ rules: [own, other], records: [] })
    expect(series.ruleSegments).toHaveLength(1)
    expect(series.ruleSegments[0].ruleVersion).toBe('V1.0')
  })
})

/* ---------------- 判定口径按测点隔离 ---------------- */

describe('判定口径只看本测点适用的规则', () => {
  /** 规则表里四类指标同表存放：裂缝相对基准、振动与温湿度绝对判定。 */
  const table = [
    makeRule({ id: 'crack@V1.0', code: 'RULE-CRACK-001', metric: 'crack_width', baselineSource: 'point', thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 } }),
    makeRule({
      id: 'vib@V1.0',
      code: 'RULE-VIB-001',
      metric: 'vibration',
      unit: 'm/s²',
      baselineSource: 'none',
      thresholds: { yellow: 0.05, orange: 0.1, red: 0.2 },
      pointIds: ['pnt_1'],
    }),
    makeRule({
      id: 'env@V1.0',
      code: 'RULE-ENV-001',
      metric: 'environment',
      baselineSource: 'none',
      thresholds: null,
      environment: { tempMin: 5, tempMax: 35, humidityMax: 80, persistenceRecords: 3 },
      pointIds: ['pnt_1'],
    }),
  ]

  it('振动测点：全表含裂缝规则时仍判为绝对判定，不画基准线', () => {
    const series = trend({
      point: makePoint({ metric: 'vibration', type: 'vibration' }),
      rules: table,
    })
    expect(series.mode).toBe('absolute')
    expect(series.baselineSegments).toHaveLength(0)
    // 阈值取本测点规则的 0.05 / 0.10 / 0.20，不是裂缝的 0.6 / 0.7 / 0.8
    expect(series.thresholdLines.map((row) => row.value)).toEqual([0.05, 0.1, 0.2])
    expect(series.thresholds).toEqual({ yellow: 0.05, orange: 0.1, red: 0.2 })
  })

  it('裂缝测点：判为相对基准，阈值线随基准平移', () => {
    const series = trend({ point: makePoint(), rules: table })
    expect(series.mode).toBe('relative')
    expect(series.baselineSegments).toHaveLength(1)
    expect(series.thresholdLines.map((row) => row.value)).toEqual([0.6, 0.7, 0.8])
  })

  it('温湿度测点：规则没有阈值，图例不列三级阈值线', () => {
    const series = trend({
      point: makePoint({ metric: 'temp_humidity', type: 'temp_humidity' }),
      rules: table,
    })
    expect(series.mode).toBe('absolute')
    expect(series.thresholds).toBeNull()
    expect(series.thresholdLines).toHaveLength(0)
  })

  it('时间范围内没有适用规则时口径为 none，不误报成相对基准', () => {
    const series = trend({ rules: [], records: [] })
    expect(series.mode).toBe('none')
    expect(series.thresholds).toBeNull()
    expect(series.ruleSegments).toHaveLength(0)
  })

  it('同一测点范围内口径换过版时报 mixed', () => {
    const v1 = makeRule({ id: 'r@V1.0', baselineSource: 'point', effectiveFrom: '2026-09-01T00:00:00.000Z' })
    const v2 = makeRule({
      id: 'r@V2.0',
      baselineSource: 'none',
      thresholds: { yellow: 0.05, orange: 0.1, red: 0.2 },
      effectiveFrom: '2026-09-15T00:00:00.000Z',
    })
    const series = trend({ rules: [v1, v2], records: [] })
    expect(series.mode).toBe('mixed')
    expect(series.ruleSegments.map((row) => row.baselineSource)).toEqual(['point', 'none'])
  })
})

/* ---------------- 数据线分段 ---------------- */

describe('间隔过大的时段在图上断开', () => {
  function pointAt(iso: string, value: number) {
    return {
      recordId: iso,
      recordNo: iso,
      sampleTime: iso,
      t: T(iso),
      value,
      state: null,
      baselineVersion: 1,
      baselineValue: 0.5,
      eventId: null,
      eventNo: '',
      eventLevel: null,
      upgraded: false,
      revision: 0,
    }
  }

  it('连续每天的记录连成一段', () => {
    const segments = splitByGap([
      pointAt('2026-09-01T09:00:00.000Z', 0.5),
      pointAt('2026-09-02T09:00:00.000Z', 0.55),
      pointAt('2026-09-03T09:00:00.000Z', 0.6),
    ])
    expect(segments).toHaveLength(1)
  })

  it('中间空了七天时断开，不画跨越大段空白的直线', () => {
    const segments = splitByGap([
      pointAt('2026-09-01T09:00:00.000Z', 0.5),
      pointAt('2026-09-02T09:00:00.000Z', 0.55),
      pointAt('2026-09-09T09:00:00.000Z', 0.52),
      pointAt('2026-09-10T09:00:00.000Z', 0.53),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(2)
  })

  it('分钟级密集采样的短暂中断不会被频繁断开', () => {
    const segments = splitByGap([
      pointAt('2026-09-01T09:00:00.000Z', 0.5),
      pointAt('2026-09-01T09:05:00.000Z', 0.51),
      pointAt('2026-09-01T09:30:00.000Z', 0.52),
      pointAt('2026-09-01T09:35:00.000Z', 0.53),
    ])
    expect(segments).toHaveLength(1)
  })

  it('空序列与单点不产生多余分段', () => {
    expect(splitByGap([])).toEqual([])
    expect(splitByGap([pointAt('2026-09-01T09:00:00.000Z', 0.5)])).toHaveLength(1)
  })

  it('趋势序列自带分段结果，供图表直接绘制', () => {
    const series = trend({
      records: [
        makeRecord({ id: 'a', recordNo: 'A', sampleTime: '2026-09-10T09:00:00.000Z', values: { width: 0.52 } }),
        makeRecord({ id: 'b', recordNo: 'B', sampleTime: '2026-09-11T09:00:00.000Z', values: { width: 0.62 } }),
        makeRecord({ id: 'c', recordNo: 'C', sampleTime: '2026-09-25T09:00:00.000Z', values: { width: 0.55 } }),
      ],
    })
    expect(series.lineSegments).toHaveLength(2)
  })
})

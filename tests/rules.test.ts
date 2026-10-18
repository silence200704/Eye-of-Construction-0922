/**
 * 预警规则判定测试。
 * 覆盖项目组提供的演示数据脚本、阈值边界、数据质量分流、变化速率、持续异常与恢复待确认。
 * 方案第 6 节要求"对规则边界、流转、幂等和统计进行必要测试"。
 */
import { describe, expect, it } from 'vitest'
import { assessRecord, levelOfRecord, previewRecord, ruleForPoint, triggerOf, type AssessInput } from '@/core/rules'
import type { MonitoringRule } from '@/types/rules'
import { crackHistory, makeDevice, makePoint, makeRecord, makeRule } from './fixtures'

const CRACK_BASELINE = { width: 0.5 }
const AT = '2026-09-15T09:00:00.000Z'

function crackInput(width: number, overrides: Partial<AssessInput> = {}): AssessInput {
  return {
    rule: makeRule(),
    point: makePoint(),
    values: { width },
    baselineValues: CRACK_BASELINE,
    quality: 'valid',
    device: undefined,
    history: [],
    at: AT,
    ...overrides,
  }
}

function preview(values: Record<string, number>, sampleTime: string) {
  return previewRecord({
    pointId: 'pnt_1',
    metric: 'crack_width',
    values,
    baselineValues: CRACK_BASELINE,
    unit: 'mm',
    sampleTime,
    sampleWindow: '',
  })
}

describe('裂缝分级（对应项目组提供的演示数据脚本）', () => {
  it.each([
    [0.52, 'normal'],
    [0.62, 'yellow'],
    [0.73, 'orange'],
    [0.82, 'red'],
  ])('宽度 %s mm 判为 %s', (width, expected) => {
    expect(assessRecord(crackInput(width)).state).toBe(expected)
  })

  it('恰好等于阈值即命中该等级，不向下取整', () => {
    expect(assessRecord(crackInput(0.6)).state).toBe('yellow')
    expect(assessRecord(crackInput(0.7)).state).toBe('orange')
    expect(assessRecord(crackInput(0.8)).state).toBe('red')
  })

  it('差一点未达阈值仍是未越限', () => {
    expect(assessRecord(crackInput(0.5999)).state).toBe('normal')
  })

  it('给出触发值、基准值与规则版本，预警可解释', () => {
    const result = assessRecord(crackInput(0.62))
    expect(result.triggerValue).toBeCloseTo(0.12, 6)
    expect(result.baselineValue).toBe(0.5)
    expect(result.ruleCode).toBe('RULE-CRACK-001')
    expect(result.ruleVersion).toBe('V1.0')
  })

  it('收缩方向同样按变化量绝对值判定', () => {
    expect(assessRecord(crackInput(0.35)).state).toBe('yellow')
  })
})

describe('数据质量分流', () => {
  it.each(['suspect', 'invalid'] as const)('质量为 %s 的越限值，完整判定和列表分级都不生成等级', (quality) => {
    expect(assessRecord(crackInput(0.82, { quality })).state).toBe('excluded')
    expect(levelOfRecord(makeRule(), makeRecord({ quality, values: { width: 0.82 } }))).toBe('excluded')
  })

  it('存疑和无效历史不能凑满连续异常条数', () => {
    const history = [
      makeRecord({ quality: 'suspect', sampleTime: '2026-09-15T08:50:00Z', values: { width: 0.62 } }),
      makeRecord({ quality: 'invalid', sampleTime: '2026-09-15T08:55:00Z', values: { width: 0.62 } }),
      makeRecord({ sampleTime: AT, values: { width: 0.62 } }),
    ]
    expect(assessRecord(crackInput(0.62, { history })).state).toBe('yellow')
  })

  it('质量标记为无效时不参与判定', () => {
    const result = assessRecord(crackInput(0.82, { quality: 'invalid' }))
    expect(result.state).toBe('excluded')
    expect(result.reason).toContain('无效')
  })

  it('超出设备量程时标记无效并进入数据核查，不触发结构预警', () => {
    const result = assessRecord(crackInput(0.82, { device: makeDevice({ rangeMin: 0, rangeMax: 0.6 }) }))
    expect(result.state).toBe('excluded')
    expect(result.reason).toContain('超出设备量程')
  })

  it('规则尚未生效时不参与当前数据判断', () => {
    const rule = makeRule({ effectiveFrom: '2027-01-01T00:00:00.000Z' })
    expect(assessRecord(crackInput(0.82, { rule })).state).toBe('excluded')
  })

  it('规则停用时不参与判定', () => {
    expect(assessRecord(crackInput(0.82, { rule: makeRule({ enabled: false }) })).state).toBe('excluded')
  })

  it('人工检查点不参与判定', () => {
    const point = makePoint({ metric: 'inspection' })
    expect(assessRecord(crackInput(0.82, { point })).state).toBe('excluded')
  })
})

describe('数据不足的处理', () => {
  it('尚未设置基准时判为数据不足，不能显示未越限', () => {
    const result = assessRecord(crackInput(0.82, { baselineValues: null }))
    expect(result.state).toBe('unknown')
    expect(result.insufficientReason).toContain('尚未设置有效基准')
  })

  it('只有一条数据时可判断绝对值，但说明无法判断变化速率', () => {
    const rule = makeRule({ rateThreshold: 0.1 })
    const result = assessRecord(crackInput(0.62, { rule }))
    expect(result.state).toBe('yellow')
    expect(result.insufficientReason).toContain('不能判断变化速率')
  })

  it('记录条数不足时说明无法判断持续趋势', () => {
    expect(assessRecord(crackInput(0.62)).insufficientReason).toContain('无法判断持续趋势')
  })
})

describe('变化速率', () => {
  const history = crackHistory([{ at: '2026-09-15T08:00:00.000Z', width: 0.52 }])

  it('一小时变化 0.10 mm 达到速率阈值，生成橙色趋势提醒', () => {
    const result = assessRecord(crackInput(0.62, { rule: makeRule({ rateThreshold: 0.1 }), history, at: AT }))
    expect(result.state).toBe('orange')
    expect(result.basis).toContain('变化速率')
  })

  it('未达速率阈值时仍按绝对值分级', () => {
    const result = assessRecord(crackInput(0.57, { rule: makeRule({ rateThreshold: 0.1 }), history, at: AT }))
    expect(result.state).toBe('normal')
    expect(result.basis).not.toContain('变化速率')
  })

  it('未配置速率阈值的规则不判速率', () => {
    expect(assessRecord(crackInput(0.62, { history, at: AT })).state).toBe('yellow')
  })

  it('历史序列包含当前记录时，仍用严格更早的一条计算速率', () => {
    const withCurrent = [...history, preview({ width: 0.62 }, AT)]
    const result = assessRecord(crackInput(0.62, {
      rule: makeRule({ rateThreshold: 0.1 }),
      history: withCurrent,
      at: AT,
    }))
    expect(result.state).toBe('orange')
    expect(result.basis).toContain('变化速率')
  })
})

describe('持续异常', () => {
  it('3 条均越限、跨度不少于 10 分钟且间隔不超过 5 分钟时升级为橙色', () => {
    const history = [
      ...crackHistory([
        { at: '2026-09-15T09:00:00.000Z', width: 0.62 },
        { at: '2026-09-15T09:05:00.000Z', width: 0.64 },
      ]),
      preview({ width: 0.66 }, '2026-09-15T09:10:00.000Z'),
    ]
    const result = assessRecord(crackInput(0.66, { history, at: '2026-09-15T09:10:00.000Z' }))
    expect(result.state).toBe('orange')
    expect(result.basis).toContain('持续异常')
  })

  it('相邻间隔超过 5 分钟时不判为持续异常', () => {
    const history = [
      ...crackHistory([
        { at: '2026-09-15T09:00:00.000Z', width: 0.62 },
        { at: '2026-09-15T09:20:00.000Z', width: 0.64 },
      ]),
      preview({ width: 0.66 }, '2026-09-15T09:30:00.000Z'),
    ]
    const result = assessRecord(crackInput(0.66, { history, at: '2026-09-15T09:30:00.000Z' }))
    expect(result.state).toBe('yellow')
  })
})

describe('恢复待确认', () => {
  it('连续 3 条低于黄色阈值 80% 时标为恢复待确认，不自动关闭问题', () => {
    const history = [
      ...crackHistory([
        { at: '2026-09-15T09:00:00.000Z', width: 0.54 },
        { at: '2026-09-16T09:00:00.000Z', width: 0.53 },
      ]),
      preview({ width: 0.53 }, '2026-09-17T09:00:00.000Z'),
    ]
    const result = assessRecord(crackInput(0.53, { history, at: '2026-09-17T09:00:00.000Z' }))
    expect(result.state).toBe('recovering')
    expect(result.reason).toContain('不自动关闭')
  })

  it('只有一条低于恢复阈值时仍按未越限处理', () => {
    expect(assessRecord(crackInput(0.54)).state).toBe('normal')
  })
})

describe('倾角判定', () => {
  const tiltRule = makeRule({
    code: 'RULE-TILT-001',
    metric: 'tilt_xy',
    unit: '°',
    thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
  })
  const tiltPoint = makePoint({ metric: 'tilt_xy', type: 'tilt' })

  function tiltInput(angleX: number, angleY: number): AssessInput {
    return {
      rule: tiltRule,
      point: tiltPoint,
      values: { angleX, angleY },
      baselineValues: { angleX: 0, angleY: 0 },
      quality: 'valid',
      device: undefined,
      history: [],
      at: AT,
    }
  }

  it.each([
    [0.04, -0.02, 'normal'],
    [0.12, -0.04, 'yellow'],
    [0.22, -0.08, 'orange'],
    [0.34, -0.12, 'red'],
  ])('X %s / Y %s 取较大方向判为 %s', (x, y, expected) => {
    expect(assessRecord(tiltInput(x, y)).state).toBe(expected)
  })

  it('取绝对值较大的方向，不换算整栋倾斜率', () => {
    const trigger = triggerOf(tiltRule, { angleX: 0.05, angleY: -0.25 }, { angleX: 0, angleY: 0 })
    expect(trigger.value).toBeCloseTo(0.25, 6)
    expect(trigger.basis).toContain('取绝对值较大方向')
  })
})

describe('振动判定', () => {
  const vibRule = makeRule({
    code: 'RULE-VIB-001',
    metric: 'vibration',
    unit: 'm/s²',
    baselineSource: 'none',
    thresholds: { yellow: 0.05, orange: 0.1, red: 0.2 },
  })
  const vibPoint = makePoint({ metric: 'vibration', type: 'vibration' })

  it.each([
    [0.04, 'normal'],
    [0.06, 'yellow'],
    [0.12, 'orange'],
    [0.22, 'red'],
  ])('RMS %s m/s² 判为 %s（绝对判定不设基准）', (rms, expected) => {
    const result = assessRecord({
      rule: vibRule,
      point: vibPoint,
      values: { accelRms: rms, accelPeak: 0.55 },
      baselineValues: null,
      quality: 'valid',
      device: undefined,
      history: [],
      at: AT,
    })
    expect(result.state).toBe(expected)
  })
})

describe('温湿度环境提醒', () => {
  const envRule = makeRule({
    code: 'RULE-ENV-001',
    metric: 'environment',
    unit: '℃ / %RH',
    baselineSource: 'none',
    thresholds: null,
    environment: { tempMin: 5, tempMax: 35, humidityMax: 80, persistenceRecords: 3 },
  })
  const envPoint = makePoint({ metric: 'temp_humidity', type: 'temp_humidity' })

  function envPreview(temperature: number) {
    return previewRecord({
      pointId: 'pnt_1',
      metric: 'temp_humidity',
      values: { temperature },
      baselineValues: null,
      unit: '℃',
      sampleTime: AT,
      sampleWindow: '',
    })
  }

  function envInput(values: { temperature?: number; humidity?: number }, history: AssessInput['history'] = []): AssessInput {
    return {
      rule: envRule,
      point: envPoint,
      values,
      baselineValues: null,
      quality: 'valid',
      device: undefined,
      history,
      at: AT,
    }
  }

  it('温度与湿度都在范围内时未越限', () => {
    expect(assessRecord(envInput({ temperature: 24, humidity: 60 })).state).toBe('normal')
  })

  it('低于 5℃ 或高于 35℃ 生成环境提醒', () => {
    expect(assessRecord(envInput({ temperature: 3, humidity: 60 })).state).toBe('yellow')
    expect(assessRecord(envInput({ temperature: 36, humidity: 60 })).state).toBe('yellow')
  })

  it('相对湿度高于 80% 生成潮湿环境提醒', () => {
    expect(assessRecord(envInput({ temperature: 24, humidity: 85 })).state).toBe('yellow')
  })

  it('连续 3 条越限生成环境复核任务，且不生成结构危险结论', () => {
    const history = [envPreview(37), envPreview(38), envPreview(39)]
    const result = assessRecord(envInput({ temperature: 39 }, history))
    expect(result.state).toBe('orange')
    expect(result.reason).toContain('不单独作为结构危险结论')
  })

  it('多高的环境读数也不会生成红色结构预警', () => {
    const history = [envPreview(45), envPreview(45), envPreview(45)]
    expect(assessRecord(envInput({ temperature: 45 }, history)).state).toBe('orange')
  })
})

describe('规则适用性', () => {
  it('尚未生效的规则不参与，生效日之后才参与', () => {
    const point = makePoint()
    const enabled = makeRule({ id: 'r1', effectiveFrom: '2026-01-01T00:00:00.000Z' })
    const future: MonitoringRule = makeRule({ id: 'r2', effectiveFrom: '2027-01-01T00:00:00.000Z' })
    expect(ruleForPoint([future], point, AT)).toBeUndefined()
    expect(ruleForPoint([enabled, future], point, AT)?.id).toBe('r1')
  })

  it('规则限定测点时，其它测点不套用', () => {
    const rule = makeRule({ pointIds: ['pnt_other'] })
    expect(ruleForPoint([rule], makePoint(), AT)).toBeUndefined()
    expect(ruleForPoint([rule], makePoint({ id: 'pnt_other' }), AT)?.code).toBe('RULE-CRACK-001')
  })

  it('人工检查点没有可用规则', () => {
    expect(ruleForPoint([makeRule()], makePoint({ metric: 'inspection' }), AT)).toBeUndefined()
  })
})

describe('演示数据脚本整段复算（验收 A02：0.62/0.73/0.82 依次黄橙红）', () => {
  interface Row { at: string; width: number; expected: string }
  const SCRIPT: Row[] = [
    { at: '2026-09-15T09:00:00.000Z', width: 0.52, expected: 'normal' },
    { at: '2026-09-16T09:00:00.000Z', width: 0.62, expected: 'yellow' },
    { at: '2026-09-17T09:00:00.000Z', width: 0.73, expected: 'orange' },
    { at: '2026-09-18T09:00:00.000Z', width: 0.82, expected: 'red' },
    { at: '2026-09-25T09:00:00.000Z', width: 0.54, expected: 'normal' },
    { at: '2026-09-25T09:05:00.000Z', width: 0.53, expected: 'normal' },
    { at: '2026-09-25T09:10:00.000Z', width: 0.53, expected: 'recovering' },
    { at: '2026-09-26T09:00:00.000Z', width: 0.53, expected: 'recovering' },
  ]

  it('按顺序录入后每一条的判定结果与标准一致', () => {
    const history: AssessInput['history'] = []
    const rule = makeRule({
      effectiveFrom: '2026-09-14T00:00:00.000Z',
      rateThreshold: 0.1,
      recovery: { yellowRatio: 0.8, minRecords: 3, minSpanMinutes: 0 },
    })
    const results = SCRIPT.map((row) => {
      const at = row.at
      const current = previewRecord({
        pointId: 'pnt_1',
        metric: 'crack_width',
        values: { width: row.width },
        baselineValues: CRACK_BASELINE,
        unit: 'mm',
        sampleTime: at,
        sampleWindow: '',
      })
      const assessment = assessRecord({
        rule,
        point: makePoint(),
        values: { width: row.width },
        baselineValues: CRACK_BASELINE,
        quality: 'valid',
        device: undefined,
        history: [...history, current],
        at,
      })
      history.push(current)
      return assessment.state
    })
    expect(results).toEqual(SCRIPT.map((row) => row.expected))
  })
})

describe('列表数值分级', () => {
  it('按记录自身的基准快照分级，历史记录不受当前基准变化影响', () => {
    const rule = makeRule()
    const before = makeRecord({ values: { width: 0.62 }, baselineValues: { width: 0.5 } })
    const after = makeRecord({ values: { width: 0.62 }, baselineValues: { width: 0.4 } })
    expect(levelOfRecord(rule, before)).toBe('yellow')
    expect(levelOfRecord(rule, after)).toBe('orange')
  })

  it('缺基准或读数时不给分级', () => {
    expect(levelOfRecord(makeRule(), makeRecord({ baselineValues: null }))).toBeNull()
  })
})

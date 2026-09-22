/**
 * 录入校验测试：覆盖方案 §2 校验要求与 §13.3 数据质量分流。
 * 方案明确要求"对规则边界、流转、幂等和统计进行必要测试"。
 */
import { describe, expect, it } from 'vitest'
import { checkReading, outOfDeviceRange, type ReadingInput } from '@/core/validate'
import { BACKFILL_THRESHOLD_MINUTES } from '@/types/catalog'
import { makeDevice, makeRecord } from './fixtures'

const ENTERED = '2026-09-15T10:10:00.000Z'

function input(overrides: Partial<ReadingInput> = {}): ReadingInput {
  return {
    pointId: 'pnt_1',
    metric: 'crack_width',
    values: { width: 0.62 },
    unit: 'mm',
    sampleTime: '2026-09-15T10:05:00.000Z',
    sampleWindow: '',
    quality: 'valid',
    qualityNote: '',
    note: '',
    excludeRecordId: null,
    device: undefined,
    enteredAt: ENTERED,
    ...overrides,
  }
}

const fieldsWith = (issues: { field: string }[]): string[] => issues.map((row) => row.field)

describe('checkReading 必填与数值校验', () => {
  it('缺项直接拦截，不按零处理', () => {
    const result = checkReading(input({ values: {} }), [])
    expect(fieldsWith(result.issues)).toContain('width')
    expect(result.issues[0].message).toContain('缺项不按零处理')
  })

  it('合法的单条记录通过，并可判断绝对值', () => {
    const result = checkReading(input(), [])
    expect(result.issues).toEqual([])
  })

  it('数值超出合理区间时拦截', () => {
    const result = checkReading(input({ values: { width: -1 } }), [])
    expect(fieldsWith(result.issues)).toContain('width')
  })

  it('单位为空时拦截', () => {
    const result = checkReading(input({ unit: '  ' }), [])
    expect(fieldsWith(result.issues)).toContain('unit')
  })

  it('振动未填统计窗口时拦截，其他指标不要求', () => {
    const vibration = checkReading(
      input({ metric: 'vibration', values: { accelRms: 0.06 }, unit: 'm/s²', sampleWindow: '' }),
      [],
    )
    expect(fieldsWith(vibration.issues)).toContain('sampleWindow')
    const crack = checkReading(input({ sampleWindow: '' }), [])
    expect(fieldsWith(crack.issues)).not.toContain('sampleWindow')
  })

  it('人工检查点不产生数值记录', () => {
    const result = checkReading(input({ metric: 'inspection', values: {} }), [])
    expect(result.issues[0].message).toContain('人工检查点')
  })
})

describe('checkReading 时间有效性', () => {
  it('采样时间格式无效时拦截', () => {
    const result = checkReading(input({ sampleTime: '' }), [])
    expect(fieldsWith(result.issues)).toContain('sampleTime')
  })

  it('采样时间晚于当前时间时拦截', () => {
    const soon = new Date(Date.now() + 3 * 3600_000).toISOString()
    const result = checkReading(input({ sampleTime: soon }), [])
    expect(fieldsWith(result.issues)).toContain('sampleTime')
    expect(result.issues[0].message).toContain('晚于当前时间')
  })

  it('同一点位同一分钟已有记录时拦截并指向原记录', () => {
    const existing = [makeRecord({ sampleTime: '2026-09-15T10:05:20.000Z' })]
    const result = checkReading(input(), existing)
    expect(fieldsWith(result.issues)).toContain('sampleTime')
    expect(result.issues[0].message).toContain('R20260915-001')
  })

  it('修订自身时不算重复', () => {
    const existing = [makeRecord({ id: 'rec_1', sampleTime: '2026-09-15T10:05:20.000Z' })]
    const result = checkReading(input({ excludeRecordId: 'rec_1' }), existing)
    expect(result.issues).toEqual([])
  })

  it('不同分钟可正常录入', () => {
    const existing = [makeRecord({ sampleTime: '2026-09-15T10:04:00.000Z' })]
    const result = checkReading(input(), existing)
    expect(result.issues).toEqual([])
  })
})

describe('历史补录标记（方案 §13.3）', () => {
  it('采样时间接近录入时间时不算补录', () => {
    const result = checkReading(input(), [])
    expect(result.backfill).toBe(false)
    expect(result.issues).toEqual([])
  })

  it('采样时间明显早于录入时间时标记补录，且要求填写补录说明', () => {
    const result = checkReading(input({ sampleTime: '2026-09-13T10:05:00.000Z' }), [])
    expect(result.backfill).toBe(true)
    expect(fieldsWith(result.issues)).toContain('note')
  })

  it('补录并填写说明后通过，仍保留补录标记', () => {
    const result = checkReading(input({ sampleTime: '2026-09-13T10:05:00.000Z', note: '按原始记录补录' }), [])
    expect(result.issues).toEqual([])
    expect(result.backfill).toBe(true)
  })

  it('恰好等于阈值不算补录，超过一分钟才算', () => {
    const base = new Date(ENTERED).getTime()
    const atThreshold = new Date(base - BACKFILL_THRESHOLD_MINUTES * 60_000).toISOString()
    const overThreshold = new Date(base - (BACKFILL_THRESHOLD_MINUTES + 1) * 60_000).toISOString()
    expect(checkReading(input({ sampleTime: atThreshold }), []).backfill).toBe(false)
    expect(checkReading(input({ sampleTime: overThreshold, note: '补录' }), []).backfill).toBe(true)
  })
})

describe('超量程软标记（方案 §13.3）', () => {
  it('设备未登记量程时不做超量程判断', () => {
    expect(outOfDeviceRange({ width: 999 }, makeDevice({ rangeMin: null, rangeMax: null }))).toBe(false)
    expect(outOfDeviceRange({ width: 999 }, undefined)).toBe(false)
  })

  it('等于量程上下限算在量程内', () => {
    const device = makeDevice({ rangeMin: 0, rangeMax: 25 })
    expect(outOfDeviceRange({ width: 0 }, device)).toBe(false)
    expect(outOfDeviceRange({ width: 25 }, device)).toBe(false)
  })

  it('超出量程时标记超量程', () => {
    const device = makeDevice({ rangeMin: 0, rangeMax: 25 })
    expect(outOfDeviceRange({ width: 26 }, device)).toBe(true)
  })

  it('超量程不阻止提交，但要求填写质量说明', () => {
    const device = makeDevice({ rangeMin: 0, rangeMax: 25 })
    const result = checkReading(input({ values: { width: 30 }, device }), [])
    expect(result.outOfRange).toBe(true)
    expect(fieldsWith(result.issues)).toContain('qualityNote')
    expect(result.issues[0].message).toContain('超出设备量程')
  })

  it('超量程并填写说明后允许保存', () => {
    const device = makeDevice({ rangeMin: 0, rangeMax: 25 })
    const result = checkReading(input({ values: { width: 30 }, device, qualityNote: '探头滑出量程，待复测' }), [])
    expect(result.issues).toEqual([])
    expect(result.outOfRange).toBe(true)
  })
})

describe('质量标记', () => {
  it('标记无效时必须说明原因', () => {
    const result = checkReading(input({ quality: 'invalid' }), [])
    expect(fieldsWith(result.issues)).toContain('qualityNote')
  })

  it('存疑不强制填写说明，但可保存并显示待复核', () => {
    const result = checkReading(input({ quality: 'suspect' }), [])
    expect(result.issues).toEqual([])
  })
})

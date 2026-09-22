/**
 * 数据一致性检查测试。
 * 方案要求"编号与状态含义不变""关联不丢失"，因此断链必须能被检出而不是静默忽略。
 */
import { describe, expect, it } from 'vitest'
import { scanIntegrity, type IntegrityInput } from '@/core/integrity'
import { makeBaseline, makeBuilding, makeDevice, makeFloor, makePoint, makeRecord } from './fixtures'

function dataset(overrides: Partial<IntegrityInput> = {}): IntegrityInput {
  return {
    buildings: [makeBuilding()],
    floors: [makeFloor()],
    points: [makePoint()],
    devices: [makeDevice()],
    baselines: [makeBaseline()],
    records: [makeRecord()],
    ...overrides,
  }
}

const kinds = (input: IntegrityInput): string[] => scanIntegrity(input).map((row) => row.kind)

describe('关联引用检查', () => {
  it('完整的关联数据不报问题', () => {
    expect(scanIntegrity(dataset())).toEqual([])
  })

  it('楼层区域被改名后，仍引用旧区域名的测点被判为区域引用失效', () => {
    const input = dataset({ floors: [makeFloor({ zones: ['二层中廊', '二层东教室'] })] })
    const issue = scanIntegrity(input).find((row) => row.kind === '测点区域引用失效')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('二层走廊')
  })

  it('测点指向不存在的楼层时报错', () => {
    expect(kinds(dataset({ points: [makePoint({ floorId: 'flr_missing' })] }))).toContain('测点楼层引用失效')
  })

  it('设备绑定的测点被删除时报错', () => {
    expect(kinds(dataset({ devices: [makeDevice({ pointId: 'pnt_missing' })] }))).toContain('设备测点引用失效')
  })

  it('监测记录指向不存在的测点时报错，并给出记录编号', () => {
    const input = dataset({
      records: [makeRecord({ id: 'rec_x', recordNo: 'R20260919-001', pointId: 'pnt_missing' })],
    })
    const issue = scanIntegrity(input).find((row) => row.kind === '记录测点引用失效')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('R20260919-001')
  })
})

describe('基准与量程检查', () => {
  it('相对基准指标缺少当前基准时给出提示', () => {
    expect(kinds(dataset({ baselines: [] }))).toContain('测点缺少基准')
  })

  it('振动测点没有基准不属于问题', () => {
    const input = dataset({
      points: [makePoint({ metric: 'vibration' })],
      baselines: [],
      devices: [makeDevice()],
    })
    expect(kinds(input)).not.toContain('测点缺少基准')
  })

  it('人工检查点不检查基准与设备', () => {
    const input = dataset({
      points: [makePoint({ metric: 'inspection', zoneId: '二层走廊' })],
      baselines: [],
      devices: [],
    })
    expect(kinds(input)).not.toContain('测点缺少基准')
    expect(kinds(input)).not.toContain('测点未登记设备')
  })

  it('同一测点出现多条当前生效基准时报错', () => {
    const input = dataset({
      baselines: [makeBaseline({ id: 'b1', version: 1 }), makeBaseline({ id: 'b2', version: 2 })],
    })
    expect(kinds(input)).toContain('基准版本冲突')
  })

  it('历史基准不算冲突', () => {
    const input = dataset({
      baselines: [makeBaseline({ id: 'b1', version: 1, current: false }), makeBaseline({ id: 'b2', version: 2 })],
    })
    expect(kinds(input)).not.toContain('基准版本冲突')
  })

  it('量程上下限顺序不合法时报错', () => {
    const input = dataset({ devices: [makeDevice({ rangeMin: 25, rangeMax: 0 })] })
    expect(kinds(input)).toContain('设备量程不合法')
  })
})

describe('检查结果排序', () => {
  it('错误排在提示之前，便于优先处理', () => {
    const input = dataset({
      points: [makePoint({ floorId: 'flr_missing' })],
      baselines: [],
    })
    const levels = scanIntegrity(input).map((row) => row.level)
    expect(levels[0]).toBe('error')
    expect(levels).toContain('warn')
  })
})

/** 业务字典与编号生成测试：变化量计算、指标能力、编号唯一性与格式。 */
import { describe, expect, it } from 'vitest'
import { METRICS, SOURCE_OPTIONS, hasNumericReadings, metricDef, pointTypeDef, sourceLabel } from '@/types/catalog'
import { nextBuildingCode, nextDeviceCode, nextPointCode, nextRecordNo, floorName } from '@/core/id'
import { toPlain } from '@/core/plain'
import type { MonitorRecord, Point } from '@/types/domain'
import { makeBuilding, makePoint, makeRecord } from './fixtures'

describe('记录来源字典', () => {
  it('CSV 导入单独标识，且不出现在手工录入的可选项里', () => {
    expect(sourceLabel('csv')).toBe('CSV 批量导入')
    expect(SOURCE_OPTIONS.map((row) => row.value)).toEqual(['manual', 'device'])
  })

  it('手工录入与设备上报各自的标签不变', () => {
    expect(sourceLabel('manual')).toBe('人工录入')
    expect(sourceLabel('device')).toBe('设备上报（演示补录）')
  })
})

describe('指标定义', () => {
  it('人工检查点不产生数值记录，也不设基准', () => {
    const def = metricDef('inspection')
    expect(def.fields).toEqual([])
    expect(def.baselineFields).toEqual([])
    expect(hasNumericReadings('inspection')).toBe(false)
  })

  it('四类监测指标都有录入字段；只有裂缝与倾角设相对基准', () => {
    expect(hasNumericReadings('crack_width')).toBe(true)
    expect(metricDef('crack_width').baselineFields).toHaveLength(1)
    expect(metricDef('tilt_xy').baselineFields).toHaveLength(2)
    expect(metricDef('vibration').baselineFields).toEqual([])
    expect(metricDef('temp_humidity').baselineFields).toEqual([])
  })

  it('每个测点类型都能映射到唯一指标，且指标在字典中存在', () => {
    for (const type of ['crack', 'tilt', 'vibration', 'temp_humidity', 'manual_check'] as const) {
      const metric = pointTypeDef(type).metric
      expect(METRICS.some((row) => row.key === metric)).toBe(true)
    }
  })
})

describe('裂缝变化量', () => {
  const deltas = (value: number, base: number) => metricDef('crack_width').deltas({ width: value }, { width: base })

  it('按方案 §13.2 脚本取值：0.50 基准下依次为 +0.02 / +0.12 / +0.23 / +0.32', () => {
    expect(deltas(0.52, 0.5)[0].value).toBe(0.02)
    expect(deltas(0.62, 0.5)[0].value).toBe(0.12)
    expect(deltas(0.73, 0.5)[0].value).toBe(0.23)
    expect(deltas(0.82, 0.5)[0].value).toBe(0.32)
  })

  it('没有基准或没有读数时不给变化量', () => {
    expect(metricDef('crack_width').deltas({ width: 0.62 }, null)).toEqual([])
    expect(metricDef('crack_width').deltas({}, { width: 0.5 })).toEqual([])
  })
})

describe('倾角变化量', () => {
  it('双轴分别比较并给出最大轴变化，不换算整栋倾斜率', () => {
    const list = metricDef('tilt_xy').deltas({ angleX: 0.35, angleY: -0.15 }, { angleX: 0.2, angleY: -0.1 })
    expect(list.map((row) => row.label)).toEqual(['ΔX 相对基准', 'ΔY 相对基准', '最大轴变化'])
    expect(list[0].value).toBe(0.15)
    expect(list[1].value).toBe(-0.05)
    expect(list[2].value).toBe(0.15)
  })

  it('负向变化取绝对值参与最大轴比较', () => {
    const list = metricDef('tilt_xy').deltas({ angleX: 0.1, angleY: -0.5 }, { angleX: 0.2, angleY: -0.1 })
    expect(list[2].value).toBe(0.4)
  })
})

describe('编号生成', () => {
  it('楼栋编号按已有最大序号递增并补零', () => {
    expect(nextBuildingCode([])).toBe('B01')
    expect(nextBuildingCode([makeBuilding({ code: 'B03' })])).toBe('B04')
  })

  it('测点编号包含楼栋、楼层与类型码，并可继续递增', () => {
    const existing: Point[] = [{ ...makePoint({ code: 'B03-F2-CRACK01' }) }]
    expect(nextPointCode({ buildingCode: 'B03', floorNo: 2, type: 'crack', existing })).toBe('B03-F2-CRACK02')
    expect(nextPointCode({ buildingCode: 'B03', floorNo: 2, type: 'manual_check', existing: [] })).toBe('B03-F2-CHECK01')
  })

  it('设备编号挂在测点编号之后', () => {
    expect(nextDeviceCode('B03-F2-CRACK01', [])).toBe('B03-F2-CRACK01-DEV1')
  })

  it('记录编号按自然日重新计数', () => {
    const existing: MonitorRecord[] = [makeRecord({ recordNo: 'R20260919-003' })]
    expect(nextRecordNo('20260919', existing)).toBe('R20260919-004')
    expect(nextRecordNo('20260920', existing)).toBe('R20260920-001')
  })

  it('楼层名称覆盖首层、地下层与普通层', () => {
    expect(floorName(0)).toBe('首层')
    expect(floorName(2)).toBe('二层')
    expect(floorName(-1)).toBe('地下一层')
    expect(floorName(12)).toBe('12层')
  })
})

describe('写库数据纯化', () => {
  it('嵌套普通对象原样保留，缺项仍保持缺项', () => {
    const plain = toPlain({ id: 'x', values: { width: 0.5 } })
    expect(plain).toEqual({ id: 'x', values: { width: 0.5 } })
    expect(Object.keys(toPlain({ values: {} }))).toEqual(['values'])
  })

  /**
   * 回归测试：IndexedDB 的结构化克隆无法处理 Vue 响应式代理，
   * 曾经导致保存监测记录时抛 DataCloneError 且界面毫无提示。
   */
  it('代理对象直接结构化克隆会失败，经纯化后可克隆', () => {
    const proxied = new Proxy({ width: 0.5 }, {})
    expect(() => structuredClone(proxied)).toThrow()
    expect(() => structuredClone(toPlain(proxied))).not.toThrow()
  })

  it('深层嵌套的代理对象同样被纯化', () => {
    const nested = { values: new Proxy({ width: 0.62 }, {}) }
    expect(() => structuredClone(nested)).toThrow()
    expect(structuredClone(toPlain(nested))).toEqual({ values: { width: 0.62 } })
  })
})

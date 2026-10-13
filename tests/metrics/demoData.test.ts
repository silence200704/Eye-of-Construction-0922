import { describe, expect, it } from 'vitest'
import { reportDemoData } from '@/core/metrics/demoData'
import { allIndicators, rangeOf } from '@/core/metrics/indicators'
import { seedPoints, seedDevices } from '@/db/seedArchive'

describe('报表临时展示数据', () => {
  it.each(['2026-10-07', '2026-11-01', '2027-01-01'])('在 %s 的本月与近七天范围都有完整统计', (today) => {
    const points = seedPoints()
    const data = reportDemoData({ today, points, devices: seedDevices() })
    for (const preset of ['month', 'week']) {
      const input = {
        ...data, range: rangeOf(preset, today), buildingId: null,
        buildingOfPoint: Object.fromEntries(points.map((row) => [row.id, row.buildingId])),
      }
      expect(allIndicators(input).map((row) => row.value)).toEqual([1.5, 0.75, 0.75])
      for (const buildingId of new Set(points.map((row) => row.buildingId))) {
        expect(allIndicators({ ...input, buildingId }).map((row) => row.value)).toEqual([1.5, 0.75, 0.75])
      }
    }
  })

  it('不覆盖输入档案，范围外保持无数据，示例编号可识别', () => {
    const points = seedPoints()
    const devices = seedDevices()
    const before = JSON.stringify({ points, devices })
    const data = reportDemoData({ today: '2026-10-07', points, devices })
    expect(JSON.stringify({ points, devices })).toBe(before)
    expect(data.events.every((row) => row.eventNo.startsWith('示例-'))).toBe(true)
    const indicators = allIndicators({
      ...data, buildingOfPoint: {}, buildingId: null,
      range: { from: '2025-01-01', to: '2025-01-31' },
    })
    expect(indicators.map((row) => row.value)).toEqual([null, null, null])
  })
})

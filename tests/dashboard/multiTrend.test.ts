import { describe, expect, it } from 'vitest'
import { buildReadingTrend } from '@/core/chart/dashboard'
import { buildSnapshot } from '@/assistant/selectors'
import { makePoint, makeRecord, makeRule } from '../fixtures'
import { setupHarness } from '../assistant/harness'

describe('看板多维传感器趋势', () => {
  it('倾角可切换 X/Y 轴，选 Y 时不误画 X 的数值', async () => {
    await setupHarness({
      points: [makePoint({ metric: 'tilt_xy', type: 'tilt' })],
      records: [makeRecord({ metric: 'tilt_xy', values: { angleX: 0.25, angleY: -0.12 }, baselineValues: { angleX: 0, angleY: 0 } })],
      rules: [makeRule({ metric: 'tilt_xy', unit: '°' })],
    })
    const snapshot = buildSnapshot()
    const x = buildReadingTrend(snapshot, ['pnt_1'], 'tilt_xy', 'angleX')
    const y = buildReadingTrend(snapshot, ['pnt_1'], 'tilt_xy', 'angleY')
    expect(x.lines[0]?.latest?.value).toBe(0.25)
    expect(y.lines[0]?.latest?.value).toBe(-0.12)
    expect(y.fieldLabel).toBe('Y 轴角度')
    expect(y.unit).toBe('°')
  })

  it('温度和湿度各用自身单位，缺少该字段时不画空线', async () => {
    await setupHarness({
      points: [makePoint({ metric: 'temp_humidity', type: 'temp_humidity' })],
      records: [makeRecord({ metric: 'temp_humidity', values: { temperature: 26.1, humidity: 61.5 } })],
      rules: [],
    })
    const snapshot = buildSnapshot()
    const humidity = buildReadingTrend(snapshot, ['pnt_1'], 'temp_humidity', 'humidity')
    expect(humidity.lines[0]?.latest?.value).toBe(61.5)
    expect(humidity.unit).toBe('%RH')
    expect(humidity.thresholds).toHaveLength(0)
    expect(buildReadingTrend(snapshot, ['pnt_1'], 'temp_humidity', 'temperature').unit).toBe('℃')
  })

  it('振动峰值展示记录但不套用只针对 RMS 的预警阈值', async () => {
    await setupHarness({
      points: [makePoint({ metric: 'vibration', type: 'vibration' })],
      records: [makeRecord({ metric: 'vibration', values: { accelRms: 0.08, accelPeak: 0.23 } })],
      rules: [makeRule({ metric: 'vibration', unit: 'm/s²', baselineSource: 'none', thresholds: { yellow: 0.05, orange: 0.1, red: 0.2 } })],
    })
    const snapshot = buildSnapshot()
    const rms = buildReadingTrend(snapshot, ['pnt_1'], 'vibration', 'accelRms')
    const peak = buildReadingTrend(snapshot, ['pnt_1'], 'vibration', 'accelPeak')
    expect(rms.thresholds.length).toBeGreaterThan(0)
    expect(peak.lines[0]?.latest?.value).toBe(0.23)
    expect(peak.thresholds).toHaveLength(0)
  })

  it('同指标可叠加多测点；基准可能不同，因此不画共享阈值线', async () => {
    await setupHarness({
      points: [makePoint(), makePoint({ id: 'pnt_2', code: 'B01-F2-CRACK02' })],
      records: [
        makeRecord({ id: 'r1', values: { width: 0.52 } }),
        makeRecord({ id: 'r2', recordNo: 'R20260915-002', pointId: 'pnt_2', values: { width: 0.72 } }),
      ],
    })
    const snapshot = buildSnapshot()
    const both = buildReadingTrend(snapshot, ['pnt_1', 'pnt_2'], 'crack_width')
    expect(both.lines.map((row) => row.pointId)).toEqual(['pnt_1', 'pnt_2'])
    expect(both.thresholds).toHaveLength(0)
    expect(buildReadingTrend(snapshot, ['pnt_2'], 'crack_width').lines[0]?.latest?.value).toBe(0.72)
  })
})

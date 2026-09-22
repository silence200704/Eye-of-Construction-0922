/**
 * 趋势图测试的共用夹具：序列口径、时间换算、序列构建与事件证据。
 * 放在 helpers 里避免两个测试文件各写一份。
 */
import { buildTrendSeries, type TrendSeriesSpec } from '@/core/chart/trend'
import type { EventEvidence } from '@/types/events'
import { makeBaseline, makePoint, makeRule } from '../fixtures'

export const SERIES: TrendSeriesSpec = { key: 'width', label: '裂缝宽度', unit: 'mm', digits: 2 }
export const T = (iso: string): number => new Date(iso).getTime()

export function evidence(recordId: string, recordNo: string, level: EventEvidence['level']): EventEvidence {
  return {
    recordId,
    recordNo,
    sampleTime: '2026-09-16T09:00:00.000Z',
    level,
    triggerValue: 0.12,
    baselineValue: 0.5,
    ruleCode: 'RULE-CRACK-001',
    ruleVersion: 'V1.0',
    thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
    basis: '相对基准变化量绝对值',
    reason: '',
    addedAt: '2026-09-16T09:05:00.000Z',
    addedBy: '测试',
    addedByRole: '学校安全管理人员',
  }
}

export function trend(overrides: Partial<Parameters<typeof buildTrendSeries>[0]> = {}) {
  return buildTrendSeries({
    point: makePoint(),
    records: [],
    baselines: [makeBaseline({ id: 'b1', version: 1, values: { width: 0.5 }, effectiveFrom: '2026-09-01T00:00:00.000Z' })],
    events: [],
    rules: [makeRule()],
    series: SERIES,
    from: T('2026-09-01T00:00:00.000Z'),
    to: T('2026-09-30T00:00:00.000Z'),
    ...overrides,
  })
}

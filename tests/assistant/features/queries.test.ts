import { describe, expect, it } from 'vitest'
import { setupHarness, NOW } from '../harness'
import { makePoint, makeRecord } from '../../fixtures'
import { resolveRange } from '@/core/chart/range'
import { validateThresholds } from '@/core/assess/thresholds'
import { db } from '@/db/database'

describe('比较、时间范围与只读试算', () => {
  it('自定义末日包含全天，错误日期和倒置范围明确拒绝', () => {
    const range = resolveRange({ preset: 'custom', start: '2026-09-18', end: '2026-09-20', now: NOW })
    expect(range.from).toBe(new Date('2026-09-18T00:00:00').getTime())
    expect(range.toExclusive).toBe(new Date('2026-09-21T00:00:00').getTime())
    expect(() => resolveRange({ preset: 'custom', start: '2026-02-30', end: '2026-03-01', now: NOW })).toThrow()
    expect(() => resolveRange({ preset: 'custom', start: '2026-09-20', end: '2026-09-18', now: NOW })).toThrow()
  })
  it('共享阈值校验保留相等阈值，拒绝非有限值和乱序', () => {
    expect(validateThresholds({ yellow: 1, orange: 1, red: 2 })).toBe('')
    expect(validateThresholds({ yellow: NaN, orange: 1, red: 2 })).not.toBe('')
    expect(validateThresholds({ yellow: 2, orange: 1, red: 3 })).not.toBe('')
  })
  it('两点近24小时只使用范围内有效读数，标注证据编号和实际差值', async () => {
    const h = await setupHarness({ points: [makePoint(), makePoint({ id: 'pnt_2', code: 'B01-F2-CRACK02' })], records: [
      makeRecord({ id: 'r1', recordNo: 'REC-A', sampleTime: '2026-09-20T10:00:00Z', values: { width: 0.62 } }),
      makeRecord({ id: 'r2', pointId: 'pnt_2', recordNo: 'REC-B', sampleTime: '2026-09-20T10:00:00Z', values: { width: 0.53 } }),
      makeRecord({ id: 'bad', recordNo: 'REC-BAD', quality: 'invalid', sampleTime: '2026-09-20T11:00:00Z', values: { width: 9 } }),
    ] })
    const result = await h.ask('比较 B01-F2-CRACK01 和 B01-F2-CRACK02 最近24小时的读数')
    expect(result.intent).toBe('point_compare')
    expect(result.status).toBe('answered')
    expect(result.evidence.map(e => e.ref)).toContain('REC-A')
    expect(result.evidence.map(e => e.ref)).not.toContain('REC-BAD')
    expect(result.facts.some(f => f.label.includes('最新值差') && Number(f.value) > 0.089)).toBe(true)
    expect(result.links.some(l => l.query.points?.includes('pnt_2'))).toBe(true)
  })
  it('试算改变候选结果但不改规则、记录、事件和审计', async () => {
    const h = await setupHarness({ records: [makeRecord({ sampleTime: '2026-09-20T10:00:00Z', values: { width: 0.6 } })] })
    const tables = [db.rules, db.records, db.events, db.workOrders, db.audits]
    const before = JSON.stringify(await Promise.all(tables.map(t => t.toArray())))
    const result = await h.ask('试算黄色阈值改为0.01毫米，最近7天哪些记录会改变等级？', { pointId: 'pnt_1' })
    expect(result.intent).toBe('rule_simulate')
    expect(result.status).toBe('answered')
    expect(result.facts.some(f => f.label === '等级变化' && Number(f.value) >= 1)).toBe(true)
    expect(JSON.stringify(await Promise.all(tables.map(t => t.toArray())))).toBe(before)
    expect(h.clock.nowKey).toBe(NOW)
  })
})

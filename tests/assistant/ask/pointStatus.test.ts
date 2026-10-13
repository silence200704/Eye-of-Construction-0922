/**
 * 问筑瞳 · 单测点问答。
 *
 * 这一组守着四条最容易被"顺手写错"的纪律：
 * 1. 只答最新**有效**记录，存疑/无效记录不能被拿去当读数；
 * 2. 历史补录要写明是补录，不能读成实时上报；
 * 3. 没有有效读数就说清楚缺什么，**不许显示"正常"**；
 * 4. 采样时间与录入时间分列。
 */
import { describe, expect, it } from 'vitest'
import { makeDevice, makePoint } from '../../fixtures'
import { NOW, claims, notes, record, setupHarness } from '../harness'

describe('问某个测点怎么样', () => {
  it('存疑的最新记录不被当作读数，改用它之前的有效记录并说明跳过原因', async () => {
    const h = await setupHarness({
      records: [
        record({ id: 'rec_ok', recordNo: 'R20260920-001', sampleTime: '2026-09-20T09:00:00.000Z', values: { width: 0.52 } }),
        record({
          id: 'rec_suspect',
          recordNo: 'R20260920-002',
          sampleTime: '2026-09-20T11:00:00.000Z',
          values: { width: 0.9 },
          quality: 'suspect',
          qualityNote: '疑似探头松动',
        }),
      ],
    })

    const result = await h.ask('二层走廊西墙裂缝测点怎么样')

    expect(result.status).toBe('answered')
    expect(result.conclusion).toContain('0.52')
    expect(result.conclusion).not.toContain('0.90')
    expect(result.provenance?.quality).toBe('valid')
    // 跳过的原因写清楚，不是含糊地"取最新一条"
    expect(notes(result)).toContain('R20260920-002')
    expect(notes(result)).toContain('存疑')
    expect(result.evidence.map((row) => row.ref)).toContain('R20260920-001')
  })

  it('只有无效记录时不显示"正常"，而是说明缺什么', async () => {
    const h = await setupHarness({
      records: [
        record({ id: 'rec_invalid', recordNo: 'R20260920-003', sampleTime: '2026-09-20T10:00:00.000Z', quality: 'invalid', qualityNote: '超量程，已作废' }),
      ],
    })

    const result = await h.ask('二层走廊西墙裂缝测点怎么样')

    expect(result.status).toBe('not_found')
    expect(claims(result)).toContain('没有可用的有效读数')
    expect(claims(result)).not.toContain('正常')
    expect(notes(result)).toContain('R20260920-003')
    expect(notes(result)).toContain('数据不足时不显示"正常"')
    expect(result.provenance?.quality).toBe('invalid')
  })

  it('完全没有记录时说明"还没有任何监测记录"', async () => {
    const h = await setupHarness({ records: [] })
    const result = await h.ask('二层走廊西墙裂缝测点怎么样')
    expect(result.status).toBe('not_found')
    expect(result.gaps.join('\n')).toContain('没有任何监测记录')
    expect(result.facts.some((row) => row.label === '记录条数')).toBe(true)
  })

  it('历史补录被标记为补录，并说明不代表实时上报', async () => {
    const h = await setupHarness({
      records: [
        record({
          id: 'rec_backfill',
          recordNo: 'R20260920-004',
          sampleTime: '2026-09-10T09:00:00.000Z',
          enteredAt: '2026-09-20T11:30:00.000Z',
          isBackfill: true,
          values: { width: 0.6 },
          note: '现场量测记录补录',
        }),
      ],
    })

    const result = await h.ask('二层走廊西墙裂缝测点怎么样')

    expect(result.timing?.isBackfill).toBe(true)
    expect(result.conclusion).toContain('历史补录')
    expect(notes(result)).toContain('不代表实时上报')
    expect(claims(result)).not.toContain('实时上报')
    // 采样时间与录入时间是两个字段，且值不同
    expect(result.timing?.sampleTime).toBe('2026-09-10T09:00:00.000Z')
    expect(result.timing?.enteredAt).toBe('2026-09-20T11:30:00.000Z')
    expect(result.timing?.sampleTime).not.toBe(result.timing?.enteredAt)
  })

  it('被修订过的记录写明修订次数，不当成原始值', async () => {
    const h = await setupHarness({
      records: [record({ id: 'rec_rev', sampleTime: '2026-09-20T10:00:00.000Z', values: { width: 0.62 }, revision: 2 })],
    })
    const result = await h.ask('二层走廊西墙裂缝测点怎么样')
    expect(result.timing?.revision).toBe(2)
    expect(result.gaps.join('\n')).toContain('已被修订 2 次')
  })

  it('读数偏旧只说读数偏旧，不说设备离线', async () => {
    const h = await setupHarness({
      records: [record({ id: 'rec_old', sampleTime: '2026-09-18T09:00:00.000Z', values: { width: 0.55 } })],
    })
    const result = await h.ask('二层走廊西墙裂缝测点怎么样')

    expect(result.timing?.freshness).toBe('stale')
    expect(notes(result)).toContain('不能判断设备离线')
    // 断言部分不能出现"设备离线"这种没有心跳依据的结论
    expect(claims(result)).not.toContain('设备离线')
    // 未接入的设备状态照实写"无设备心跳"
    expect(result.provenance?.deviceHealthLabel).toContain('无设备心跳')
  })

  it('人工登记为"正常在线"的设备，回答里必须标出这是人工登记字段', async () => {
    const h = await setupHarness({
      devices: [makeDevice({ id: 'dev_1', health: 'online' })],
      records: [record({ id: 'rec_h', sampleTime: '2026-09-20T11:50:00.000Z', values: { width: 0.52 } })],
    })
    const result = await h.ask('二层走廊西墙裂缝测点怎么样')

    expect(result.provenance?.deviceHealthLabel).toBe('正常在线（人工登记）')
    expect(notes(result)).toContain('人工登记')
    expect(notes(result)).toContain('不是设备心跳')
  })

  it('给出相对基准的变化量与基准口径', async () => {
    const h = await setupHarness({
      records: [record({ id: 'rec_delta', sampleTime: '2026-09-20T11:30:00.000Z', values: { width: 0.62 }, baselineValues: { width: 0.5 } })],
    })
    const result = await h.ask('二层走廊西墙裂缝测点怎么样')
    expect(result.facts.some((row) => row.label.includes('Δw') && row.value === '+0.12')).toBe(true)
    expect(result.timing?.freshnessLabel).toContain('2026-09-20')
  })

  it('人工检查点说明它按设计不产生数值记录', async () => {
    const h = await setupHarness({
      points: [makePoint({ id: 'pnt_m', code: 'B01-F1-CHECK01', name: '一层走廊人工检查点', metric: 'inspection', type: 'manual_check' })],
      devices: [],
      records: [],
    })
    const result = await h.ask('B01-F1-CHECK01 怎么样')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('人工检查点')
    expect(result.gaps.join('\n')).toContain('不产生数值记录')
  })

  it('同一采样时刻：有效记录优先于无效记录，且指出被跳过的那条', async () => {
    const h = await setupHarness({
      records: [
        record({ id: 'rec_v', recordNo: 'R20260920-010', sampleTime: '2026-09-20T11:00:00.000Z', values: { width: 0.7 } }),
        record({ id: 'rec_i', recordNo: 'R20260920-011', sampleTime: '2026-09-20T11:00:00.000Z', values: { width: 9.9 }, quality: 'invalid' }),
      ],
    })
    const result = await h.ask('二层走廊西墙裂缝测点怎么样')
    expect(result.conclusion).toContain('0.70')
    expect(notes(result)).toContain('R20260920-011')
    expect(result.computedAt).toBe(NOW)
  })
})

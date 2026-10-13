/**
 * 「读数恢复了吗」与「带我到 3D 看位置」两条问法。
 *
 * 两条都不重算任何东西：
 * - 恢复：只引用最新有效读数、事件证据里的峰值与阈值快照、事件当前状态；
 * - 3D：只给白名单深链，页面打开前自己会再核对归属。
 */
import { describe, expect, it } from 'vitest'
import type { AlarmEvent, EventEvidence } from '@/types/events'
import { makeEvent } from '../../fixtures'
import { record, setupHarness } from '../harness'

function evidence(recordId: string, sampleTime: string): EventEvidence {
  return {
    recordId,
    recordNo: 'R20260919-001',
    sampleTime,
    level: 'red',
    triggerValue: 0.32,
    baselineValue: 0.5,
    ruleCode: 'RULE-CRACK-001',
    ruleVersion: 'V1.0',
    thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
    basis: '裂缝宽度相对基准变化',
    reason: '超过红色阈值',
    addedAt: sampleTime,
    addedBy: '测试',
    addedByRole: '系统',
  }
}

const records = [
  record({ id: 'r_now', recordNo: 'R20260920-002', sampleTime: '2026-09-20T11:50:00.000Z', values: { width: 0.53 }, baselineValues: { width: 0.5 } }),
  record({ id: 'r_peak', recordNo: 'R20260919-001', sampleTime: '2026-09-19T10:00:00.000Z', values: { width: 0.82 }, baselineValues: { width: 0.5 } }),
]

function event(overrides: Partial<AlarmEvent> = {}): AlarmEvent {
  return makeEvent({
    id: 'e1',
    eventNo: 'E20260919-001',
    level: 'red',
    peakLevel: 'red',
    status: 'recovering',
    evidences: [evidence('r_peak', '2026-09-19T10:00:00.000Z')],
    ...overrides,
  })
}

describe('读数恢复了吗', () => {
  it('给出最新有效读数、与事件证据峰值的比较、以及事件当前状态', async () => {
    const h = await setupHarness({ records, events: [event()] })
    const result = await h.ask('读数恢复了吗？', { pointId: 'pnt_1' })

    expect(result.intent).toBe('reading_recovery')
    expect(result.conclusion).toContain('0.53')
    expect(result.conclusion).toContain('0.82')
    expect(result.conclusion).toContain('低 0.29')
    expect(result.conclusion).toContain('恢复待确认')
    // 当前值与峰值分列，不会有人把 0.82 当成现在的值
    const facts = result.facts.map((row) => `${row.label}=${row.value}${row.unit}`).join('\n')
    expect(facts).toContain('裂缝宽度=0.53mm')
    expect(facts).toContain('事件证据峰值（裂缝宽度）=0.82mm')
  })

  it('只引用证据快照里的阈值，并说明助手不重算、不自动关闭', async () => {
    const h = await setupHarness({ records, events: [event()] })
    const result = await h.ask('读数恢复了吗？', { pointId: 'pnt_1' })
    const facts = result.facts.map((row) => `${row.label}=${row.value}`).join('\n')
    expect(facts).toContain('当次判定阈值=黄 0.10 / 橙 0.20 / 红 0.30mm')
    expect(facts).toContain('判定口径=裂缝宽度相对基准变化')
    const gaps = result.gaps.join('\n')
    expect(gaps).toContain('**不等于**可以关闭事件')
    expect(gaps).toContain('关闭事件需要由学校安全管理人员在原工作台选择关闭依据后确认')
    expect(result.dataNotes.join('\n')).toContain('不重算阈值')
  })

  it('没有有效读数时不显示"正常"，也不拿旧读数顶替', async () => {
    const h = await setupHarness({ records: [record({ quality: 'suspect' })], events: [event()] })
    const result = await h.ask('读数恢复了吗？', { pointId: 'pnt_1' })
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('没有可用的有效读数')
    expect(result.gaps.join('\n')).toContain('给不出这个结论')
  })

  it('没有关联事件时说清"没有恢复这件事可判"，但仍给出读数', async () => {
    const h = await setupHarness({ records, events: [] })
    const result = await h.ask('读数恢复了吗？', { pointId: 'pnt_1' })
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('没有关联的预警事件')
    expect(result.facts.map((row) => row.value).join('|')).toContain('0.53')
  })
})

describe('带我到 3D 看位置', () => {
  it('给出同一测点的 3D 深链（楼栋 + 楼层 + 测点）与 2D 兜底', async () => {
    const h = await setupHarness({ records, events: [event()] })
    const result = await h.ask('带我到 3D 看位置。', { pointId: 'pnt_1' })

    expect(result.intent).toBe('spatial_go')
    const spatial = result.links.find((row) => row.kind === 'spatial_3d')
    expect(spatial?.query).toMatchObject({ view: '3d', b: 'bld_1', f: 'flr_1', point: 'pnt_1' })
    expect(result.links.some((row) => row.kind === 'point_building')).toBe(true)
    // 说的是"页面会再核对归属"，不是"一定打开成功"
    expect(result.gaps.join('\n')).toContain('页面打开前会再核对一遍归属')
  })

  it('不把照片区域映射成 3D 裂缝，也不替用户跳转', async () => {
    const h = await setupHarness({ records, events: [event()] })
    const result = await h.ask('带我到 3D 看位置。', { pointId: 'pnt_1' })
    const text = [...result.gaps, ...result.dataNotes].join('\n')
    expect(text).toContain('不做图像到 3D 模型的配准')
    expect(text).toContain('不替你跳转')
    expect(text).toContain('非实测图纸或 BIM')
  })

  it('测点不在档案里时不猜位置', async () => {
    const h = await setupHarness({ records, events: [event()] })
    const result = await h.ask('带我到 3D 看位置。', { pointId: 'pnt_missing' })
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('已不在当前数据集')
  })
})

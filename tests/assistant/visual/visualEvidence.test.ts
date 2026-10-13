/**
 * 小瞳视觉证据联动 · 问法与组合（方案 §34/§36）。
 *
 * 守四件事：
 * 1. **问法**：固定的八条演示问法各归其位，原有问法一条都没被抢走；
 * 2. **组合**：当前有效读数与历史峰值分列，峰值一定带着事件编号与证据；
 * 3. **降级**：没素材、只有一张、不可比对、两个口径不一致都如实说，不硬凑结论；
 * 4. **只读**：视觉问答全程不写库。
 */
import { describe, expect, it } from 'vitest'
import { askZhutong } from '@/assistant/ask'
import { composeVisualEvidence } from '@/assistant/linkage'
import type { AssistantSnapshot } from '@/assistant/selectors'
import type { PointRef } from '@/assistant/resolve'
import type { AskMediaPairPreview, AskRegionKey, AskVisualEvidencePreview } from '@/assistant/types'
import { db } from '@/db/database'
import type { AlarmEvent, EventEvidence } from '@/types/events'
import type { MonitorRecord } from '@/types/domain'
import { makeEvent, makePoint } from '../../fixtures'
import { NOW, record, setupHarness } from '../harness'

const REGIONS = { crack: { x: 0.3, y: 0.3, w: 0.1, h: 0.3 }, control: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 } }

function evidence(recordId: string, triggerValue: number, sampleTime: string): EventEvidence {
  return {
    recordId,
    recordNo: 'R20260920-001',
    sampleTime,
    level: 'red',
    triggerValue,
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

/** 组合函数的输入快照：只填这个用例真正要读的字段，其余留空。 */
function snapshotOf(input: { records: MonitorRecord[]; events: AlarmEvent[] }): AssistantSnapshot {
  return {
    now: NOW,
    buildings: [],
    points: [],
    devices: [],
    issues: [],
    workOrders: [],
    tasks: [],
    records: input.records,
    events: input.events,
    rules: [],
    baselines: [],
    media: { frames: [], compare: null, videoLoaded: false },
    ruleAt: () => undefined,
    baselineAt: () => undefined,
  }
}

function pointRef(): PointRef {
  return {
    id: 'pnt_1',
    code: 'B01-F2-CRACK01',
    name: '二层走廊西墙裂缝测点',
    zoneId: 'zone_w',
    buildingId: 'bld_1',
    buildingName: '1号教学楼',
    floorId: 'flr_1',
    floorName: '二层',
    metric: 'crack_width',
    dataSource: 'demo',
    archived: false,
  }
}

function pairPreview(): AskMediaPairPreview {
  return {
    kind: 'media_pair',
    pointId: 'pnt_1',
    beforeId: 'media_before',
    afterId: 'media_after',
    source: 'builtin',
    note: '基于实拍素材的变化演示，非真实连续拍摄；修改仅限登记区域内的裂缝。',
    regions: REGIONS,
  }
}

function resultOf(status: 'changed' | 'stable' | 'incomparable', changedRatio: number) {
  return {
    pointId: 'pnt_1',
    beforeId: 'media_before',
    afterId: 'media_after',
    region: REGIONS.crack,
    status,
    summary: `${status} 的说明文字`,
    changedRatio,
    comparedAt: '2026-09-20T11:30:00.000Z',
  }
}

const none = { crack: null, control: null, custom: null }

describe('八条演示问法的归属', () => {
  it('这面墙的裂缝有什么变化 / 给我看数据和照片 → 视觉证据联动', async () => {
    const h = await setupHarness()
    for (const question of ['这面墙的裂缝有什么变化？', '给我看数据和照片。', '这面墙有什么变化']) {
      const result = await h.ask(question)
      expect(result.intent, question).toBe('visual_evidence')
    }
  })

  it('放大变化区域 / 完好墙面也变了吗 → 区域操作', async () => {
    const h = await setupHarness()
    expect((await h.ask('放大变化区域。')).intent).toBe('visual_region')
    expect((await h.ask('完好墙面也变了吗？')).intent).toBe('visual_region')
  })

  it('对应哪个传感器 → 仍然是单测点状态（沿用上下文），不是视觉问法', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', recordNo: 'R20260920-001' })] })
    const result = await h.ask('对应哪个传感器？', { pointId: 'pnt_1' })
    expect(result.intent).toBe('point_status')
    expect(result.conclusion).toContain('B01-F2-CRACK01')
  })

  it('带我到 3D 看位置 / 为什么触发红色 / 读数恢复了吗 各归其位', async () => {
    const h = await setupHarness({ events: [makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red' })], records: [record({ id: 'r1', recordNo: 'R20260920-001' })] })
    expect((await h.ask('带我到 3D 看位置。', { pointId: 'pnt_1' })).intent).toBe('spatial_go')
    expect((await h.ask('为什么触发红色？', { eventId: 'e1' })).intent).toBe('event_reason')
    expect((await h.ask('读数恢复了吗？', { pointId: 'pnt_1' })).intent).toBe('reading_recovery')
  })

  it('原有问法没被抢走：照片有变化吗仍是影像对比，测点怎么样仍是单测点', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', recordNo: 'R20260920-001' })] })
    expect((await h.ask('照片有变化吗')).intent).toBe('media_compare')
    expect((await h.ask('二层走廊西墙裂缝测点怎么样')).intent).toBe('point_status')
    expect((await h.ask('全校现在监测如何')).intent).toBe('campus_overview')
  })
})

describe('没有素材时如实降级', () => {
  it('一张影像都没有：说清去系统设置准备，不在提问时造素材', async () => {
    const h = await setupHarness({ records: [] })
    const result = await h.ask('这面墙的裂缝有什么变化？')
    expect(result.status).toBe('not_found')
    expect(result.gaps.join('\n')).toContain('系统设置')
    expect(result.previews).toEqual([])
    // 提问不写库：素材只在设置页载入
    expect(await db.attachments.count()).toBe(0)
  })

  it('只有一张影像：给单图形态，不做任何变化结论', async () => {
    const h = await setupHarness({ records: [] })
    const { useMediaStore } = await import('@/stores/media')
    useMediaStore().frames.push({
      id: 'media_only',
      pointId: 'pnt_1',
      origin: 'demo_public',
      capturedAt: '2026-09-20T09:00:00.000Z',
      label: '公开实拍参考图',
      fileName: 'commons-crack-example.jpg',
      size: 10,
      width: 960,
      height: 720,
      blob: new Blob([new Uint8Array([1, 2, 3])]),
      timeCode: null,
    })
    const result = await h.ask('这面墙的裂缝有什么变化？')
    const card = result.previews[0]
    expect(card.kind).toBe('visual_evidence')
    if (card.kind !== 'visual_evidence') return
    expect(card.pair).toBeNull()
    expect(card.single?.id).toBe('media_only')
    expect(result.conclusion).toContain('只有一张可比影像')
    expect(result.gaps.join('\n')).toContain('不给变化结论')
    expect(card.results).toEqual(none)
  })

  it('没有线索也没有上下文：按当前会话影像所属测点回答，并把口径写出来', async () => {
    const h = await setupHarness({ records: [], events: [] })
    const { useMediaStore } = await import('@/stores/media')
    useMediaStore().frames.push({
      id: 'media_a', pointId: 'pnt_1', origin: 'upload', capturedAt: '2026-09-20T09:00:00.000Z',
      label: '现场照片', fileName: 'a.jpg', size: 3, width: 40, height: 40,
      blob: new Blob([new Uint8Array([1, 2, 3])]), timeCode: null,
    })
    const result = await h.ask('给我看数据和照片。')
    expect(result.status).toBe('answered')
    expect(result.dataNotes.join('|')).toContain('按当前会话影像所属测点回答')
  })

  it('多个测点都有影像时先给候选，不挑一个', async () => {
    const h = await setupHarness({
      points: [
        makePoint({ id: 'pnt_1', code: 'B01-F2-CRACK01' }),
        makePoint({ id: 'pnt_2', code: 'B01-F2-CRACK02', name: '二层东墙裂缝测点' }),
      ],
      records: [],
    })
    const { useMediaStore } = await import('@/stores/media')
    for (const id of ['pnt_1', 'pnt_2']) {
      useMediaStore().frames.push({
        id: `media_${id}`, pointId: id, origin: 'upload', capturedAt: '2026-09-20T09:00:00.000Z',
        label: '现场照片', fileName: `${id}.jpg`, size: 3, width: 40, height: 40,
        blob: new Blob([new Uint8Array([1, 2, 3])]), timeCode: null,
      })
    }
    const result = await h.ask('给我看数据和照片。')
    expect(result.status).toBe('need_choice')
    expect(result.candidates.length).toBe(2)
  })

  it('问句含糊不清时不猜测点：先给候选', async () => {
    const h = await setupHarness({
      points: [
        makePoint({ id: 'pnt_1', code: 'B01-F2-CRACK01' }),
        makePoint({ id: 'pnt_2', code: 'B01-F2-CRACK02', name: '二层东墙裂缝测点' }),
      ],
      records: [],
    })
    const result = await h.ask('这条裂缝有什么变化')
    expect(result.status).toBe('need_choice')
    expect(result.candidates.length).toBe(2)
  })
})

describe('组合函数：读数、峰值与区域结论分列', () => {
  const records = [
    record({ id: 'r_low', recordNo: 'R-002', sampleTime: '2026-09-20T10:00:00.000Z', values: { width: 0.53 }, baselineValues: { width: 0.5 } }),
    record({ id: 'r_peak', recordNo: 'R-001', sampleTime: '2026-09-19T10:00:00.000Z', values: { width: 0.82 }, baselineValues: { width: 0.5 } }),
  ]
  const events = [
    makeEvent({
      id: 'e1',
      eventNo: 'E20260920-001',
      level: 'orange',
      peakLevel: 'red',
      status: 'recovering',
      evidences: [evidence('r_peak', 0.32, '2026-09-19T10:00:00.000Z')],
    }),
  ]

  function compose(active: AskRegionKey, results: AskVisualEvidencePreview['results']) {
    return composeVisualEvidence({
      snapshot: snapshotOf({ records, events }),
      point: pointRef(),
      pair: pairPreview(),
      single: null,
      results,
      active,
      matchNote: '沿用上一轮明确选定的测点',
    })
  }

  it('当前有效读数与历史峰值分列：峰值带事件编号、等级与证据记录', () => {
    const draft = compose('crack', { ...none, crack: resultOf('changed', 0.15), control: resultOf('stable', 0) })
    const card = draft.previews?.[0]
    expect(card?.kind).toBe('visual_evidence')
    if (card?.kind !== 'visual_evidence') return
    expect(card.current).toMatchObject({ value: '0.53', unit: 'mm', recordNo: 'R-002' })
    // 峰值取事件证据里那条记录（0.82），不是判定值 0.32，也不是当前值
    expect(card.peak).toMatchObject({ value: '0.82', unit: 'mm', eventNo: 'E20260920-001' })
    expect(card.peak?.levelLabel).toContain('红色')
    expect(card.peak?.sourceNote).toContain('R20260920-001')
    expect(card.event).toMatchObject({ statusLabel: '恢复待确认' })
  })

  it('证据列表引用真正峰值记录，不把后来的较低读数标成峰值来源', () => {
    const event = makeEvent({
      ...events[0], evidences: [
        { ...evidence('r_peak', 0.32, records[1]!.sampleTime), recordNo: 'R-PEAK' },
        { ...evidence('r_low', 0.03, records[0]!.sampleTime), recordNo: 'R-LOW' },
      ],
    })
    const result = composeVisualEvidence({
      snapshot: snapshotOf({ records, events: [event] }), point: pointRef(),
      pair: pairPreview(), single: null, results: none, active: 'crack', matchNote: '精确匹配',
    })
    expect(result.evidence?.find(row => row.detail.includes('历史峰值来源'))).toMatchObject({ id: 'r_peak', ref: 'R-PEAK' })
  })

  it('区域结论用实际算出的数：裂缝区 15.0%、对照区 0.0%，都写出来', () => {
    const draft = compose('crack', { ...none, crack: resultOf('changed', 0.15), control: resultOf('stable', 0) })
    expect(draft.conclusion).toContain('15.0%')
    expect(draft.conclusion).toContain('完好墙面（对照） 0.0%')
    expect(draft.conclusion).toContain('关联事件 E20260920-001')
  })

  it('换到完好墙面：结论换成对照区在前，仍然两区都报', () => {
    const draft = compose('control', { ...none, crack: resultOf('changed', 0.15), control: resultOf('stable', 0) })
    expect(draft.conclusion).toContain('完好墙面（对照）的实际像素差异 0.0%')
    expect(draft.conclusion).toContain('登记裂缝区 15.0%')
  })

  it('不可比对时把原因放在最前，并且不显示 0% 当结论', () => {
    const draft = compose('crack', { ...none, crack: resultOf('incomparable', 0), control: resultOf('stable', 0) })
    expect(draft.gaps[0]).toContain('不可比对')
    expect(draft.conclusion).toContain('incomparable 的说明文字')
    expect(draft.conclusion).not.toContain('登记裂缝区的实际像素差异 0.0%')
    expect(draft.gaps.join('|')).not.toContain('读数与影像都没有明显变化')
  })

  it('读数上升但影像差异弱：两个事实并列，不替用户下结论', () => {
    const rising = [
      record({ id: 'r1', recordNo: 'R-001', sampleTime: '2026-09-19T10:00:00.000Z', values: { width: 0.52 }, baselineValues: { width: 0.5 } }),
      record({ id: 'r2', recordNo: 'R-002', sampleTime: '2026-09-20T10:00:00.000Z', values: { width: 0.62 }, baselineValues: { width: 0.5 } }),
    ]
    const draft = composeVisualEvidence({
      snapshot: snapshotOf({ records: rising, events }),
      point: pointRef(),
      pair: pairPreview(),
      single: null,
      results: { ...none, crack: resultOf('stable', 0.01), control: resultOf('stable', 0) },
      active: 'crack',
      matchNote: '沿用上一轮明确选定的测点',
    })
    const text = draft.gaps.join('\n')
    expect(text).toContain('读数在上升')
    expect(text).toContain('影像差异弱只能说明')
  })

  it('三个主要去向排在最前，且都是现有白名单深链', () => {
    const draft = compose('crack', { ...none, crack: resultOf('changed', 0.15) })
    const links = draft.links ?? []
    expect(links.slice(0, 3).map((row) => row.kind)).toEqual(['spatial_3d', 'event_detail', 'media_page'])
    expect(links[0].query).toMatchObject({ view: '3d', b: 'bld_1', f: 'flr_1', point: 'pnt_1' })
    expect(links[1].query.event).toBe('e1')
  })

  it('口径写全：毫米来自记录、像素来自图像、预设区域不是自动识别、不生成预警', () => {
    const draft = compose('crack', { ...none, crack: resultOf('changed', 0.15) })
    const text = [...draft.gaps, ...(draft.dataNotes ?? [])].join('\n')
    expect(text).toContain('毫米')
    expect(text).toContain('像素占比来自图像计算')
    expect(text).toContain('人工预设的示范区域')
    expect(text).toContain('不生成正式预警')
    expect(text).toContain('没有联网识别')
    expect(draft.previews?.[0]).toMatchObject({ kind: 'visual_evidence', method: expect.stringContaining('像素差阈值 18') })
  })

  it('视觉问答全程不写库：问完前后本地表一字未动', async () => {
    const h = await setupHarness({ records, events })
    const eventsBefore = await db.events.count()
    const auditsBefore = await db.audits.count()
    await h.ask('这面墙的裂缝有什么变化？', { pointId: 'pnt_1' })
    await h.ask('完好墙面也变了吗？', { pointId: 'pnt_1' })
    await h.ask('读数恢复了吗？', { pointId: 'pnt_1' })
    await h.ask('带我到 3D 看位置。', { pointId: 'pnt_1' })
    expect(await db.events.count()).toBe(eventsBefore)
    expect(await db.audits.count()).toBe(auditsBefore)
    expect(await db.attachments.count()).toBe(0)
  })

  it('问句没点名测点时沿用上一轮明确选定的测点，并在口径里写明', async () => {
    const h = await setupHarness({ records, events })
    const result = await h.ask('给我看数据和照片。', { pointId: 'pnt_1' })
    expect(result.dataNotes.join('\n')).toContain('沿用上一轮明确选定的测点')
    expect(result.facts.map((row) => row.value).join('|')).toContain('B01-F2-CRACK01')
  })

  it('视觉问答也不推进共享时钟', async () => {
    const h = await setupHarness({ records, events })
    await askZhutong('这面墙的裂缝有什么变化？', { context: { pointId: 'pnt_1' } })
    expect(h.clock.nowKey).toBe(NOW)
  })
})

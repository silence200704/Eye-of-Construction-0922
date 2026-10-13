import { describe, expect, it } from 'vitest'
import { buildSpatialTour } from '@/assistant/guide/spatialTour'
import { buildSpatialTourLink } from '@/assistant/actions'
import type { AssistantSnapshot } from '@/assistant/selectors/snapshot'
import { buildCampusModel } from '@/core/spatial/project'
import { seedDataset } from '@/db/seed'
import { makeEvent } from '../../fixtures'

function input() {
  const data = seedDataset()
  return {
    model: buildCampusModel({ buildings: data.buildings, floors: data.floors, points: data.points }),
    snapshot: { records: data.records, events: data.events } as AssistantSnapshot,
    pointId: data.points.find((row) => row.code === 'B03-F2-CRACK01')?.id ?? '',
    eventId: '',
  }
}

describe('小瞳空间讲解只读稿', () => {
  it('同一测点贯穿六步，读数来自有效记录，定位链接带全部 ID', () => {
    const source = input()
    const before = JSON.stringify(source.snapshot)
    const result = buildSpatialTour(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.steps.map((row) => row.stage)).toEqual(['campus', 'building', 'floor', 'point', 'reading', 'evidence'])
    expect(new Set(result.steps.map((row) => row.pointId)).size).toBe(1)
    expect(result.steps[4].detail).toContain('采样')
    expect(JSON.stringify(source.snapshot)).toBe(before)
    const link = buildSpatialTourLink({
      buildingId: result.steps[0].buildingId,
      floorId: result.steps[0].floorId,
      pointId: result.steps[0].pointId,
    }, result.eventId ?? '')
    expect(link.query).toMatchObject({ view: '3d', tour: '1', b: result.steps[0].buildingId, f: result.steps[0].floorId, point: source.pointId })
  })

  it('指定事件与测点不一致时拒绝讲解，不串错编号', () => {
    const source = input()
    const event = makeEvent({ pointId: 'pnt_other' })
    source.snapshot.events = [event]
    expect(buildSpatialTour({ ...source, eventId: event.id })).toMatchObject({ ok: false, reason: expect.stringContaining('不属于同一对象') })
  })

  it('指定红色事件时只复述其已保存证据编号和规则版本', () => {
    const source = input()
    const event = makeEvent({
      pointId: source.pointId,
      level: 'red',
      evidences: [{
        recordId: 'rec_demo', recordNo: 'R-DEMO-001', sampleTime: '2026-09-20T09:00:00.000Z',
        level: 'red', triggerValue: 0.82, baselineValue: 0.5, ruleCode: 'RULE-CRACK-001',
        ruleVersion: 'V1.0', thresholds: null, basis: 'relative', reason: '演示规则判定',
        addedAt: '2026-09-20T09:01:00.000Z', addedBy: '演示', addedByRole: 'safety',
      }],
    })
    source.snapshot.events = [event]
    const result = buildSpatialTour({ ...source, eventId: event.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.eventId).toBe(event.id)
    expect(result.steps[5].detail).toContain('R-DEMO-001')
    expect(result.steps[5].detail).toContain('V1.0')
  })

  it('已删除事件与不存在测点都给明确原因', () => {
    const source = input()
    expect(buildSpatialTour({ ...source, eventId: 'evt_missing' })).toMatchObject({ ok: false, reason: expect.stringContaining('不在当前数据集') })
    expect(buildSpatialTour({ ...source, pointId: 'pnt_missing' })).toMatchObject({ ok: false, reason: expect.stringContaining('不在 3D 档案') })
  })

  it('没有关联事件时不编造红色原因', () => {
    const source = input()
    const result = buildSpatialTour({ ...source, snapshot: { ...source.snapshot, events: [] } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.steps[5].detail).toContain('不虚构红色原因')
  })
})

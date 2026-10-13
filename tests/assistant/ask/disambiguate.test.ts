/**
 * 问筑瞳 · 实体消歧。
 *
 * 这一组守的是"**不猜**"：同名测点必须让用户选，编号不存在就照实说找不到，
 * 上下文只在对象仍然存在时沿用（数据集被替换后自动失效）。
 * 同名场景直接照着示例校区来：B01 / B02 / B03 各有一个「一层走廊人工检查点」。
 */
import { describe, expect, it } from 'vitest'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'
import { claims, setupHarness } from '../harness'

const CRACK_CODE = 'B01-F2-CRACK01'

function campus() {
  return {
    buildings: [
      makeBuilding({ id: 'bld_b01', code: 'B01', name: '1号综合楼' }),
      makeBuilding({ id: 'bld_b03', code: 'B03', name: '3号教学楼' }),
      makeBuilding({ id: 'bld_b02', code: 'B02', name: '2号实验楼' }),
    ],
    floors: [makeFloor({ id: 'flr_b01', buildingId: 'bld_b01', floorNo: 1, name: '一层' }), makeFloor({ id: 'flr_b03', buildingId: 'bld_b03', floorNo: 1, name: '一层' }), makeFloor({ id: 'flr_b02', buildingId: 'bld_b02', floorNo: 1, name: '一层' })],
    points: [
      makePoint({ id: 'pnt_c1', code: 'B01-F1-CHECK01', name: '一层走廊人工检查点', buildingId: 'bld_b01', floorId: 'flr_b01', zoneId: '一层走廊', metric: 'inspection', type: 'manual_check' }),
      makePoint({ id: 'pnt_c2', code: 'B02-F1-CHECK01', name: '一层走廊人工检查点', buildingId: 'bld_b02', floorId: 'flr_b02', zoneId: '一层走廊', metric: 'inspection', type: 'manual_check' }),
      makePoint({ id: 'pnt_c3', code: 'B03-F1-CHECK01', name: '一层走廊人工检查点', buildingId: 'bld_b03', floorId: 'flr_b03', zoneId: '一层走廊', metric: 'inspection', type: 'manual_check' }),
      makePoint({ id: 'pnt_k1', code: CRACK_CODE, name: '二层走廊西墙裂缝测点', buildingId: 'bld_b01', floorId: 'flr_b01', zoneId: '二层走廊', metric: 'crack_width' }),
      makePoint({ id: 'pnt_k3', code: 'B03-F2-CRACK01', name: '二层走廊西墙裂缝测点', buildingId: 'bld_b03', floorId: 'flr_b03', zoneId: '二层走廊', metric: 'crack_width' }),
      makePoint({ id: 'pnt_t3', code: 'B03-F2-TILT01', name: '二层走廊中柱倾角测点', buildingId: 'bld_b03', floorId: 'flr_b03', zoneId: '二层走廊', metric: 'tilt_xy', type: 'tilt' }),
    ],
    devices: [],
  }
}

describe('同名测点消歧', () => {
  it('三个「一层走廊人工检查点」不猜点，返回候选清单', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask('一层走廊人工检查点怎么样')

    expect(result.status).toBe('need_choice')
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates.map((row) => row.label)).toContain('B03-F1-CHECK01 一层走廊人工检查点')
    expect(result.gaps.join('\n')).toContain('不会替你选测点')
    expect(result.conclusion).toContain('3 个测点')
  })

  it('候选里的每个候选都带位置与指标，够人分辨', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask('一层走廊人工检查点怎么样')
    expect(result.candidates.every((row) => row.detail.includes('测试楼') || row.detail.includes('楼'))).toBe(true)
    expect(result.candidates.every((row) => row.detail.includes('人工检查'))).toBe(true)
  })

  it('带上楼栋就能定位到唯一测点（按楼栋 + 指标消歧）', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask('3号教学楼裂缝测点怎么样')

    expect(result.status).toBe('not_found') // 该测点没有记录 → 无有效读数，但对象已唯一定位
    expect(result.conclusion).toContain('B03-F2-CRACK01')
    expect(result.dataNotes.join('\n')).toContain('3号教学楼')
  })

  it('按测点编号精确匹配，优先于名称匹配', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask(`${CRACK_CODE} 怎么样`)
    expect(result.dataNotes.join('\n')).toContain('按测点编号')
    expect(result.conclusion).toContain(CRACK_CODE)
  })

  it('编号不在档案里时照实说找不到，不退回别的点', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask('B99-F9-CRACK01 怎么样')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('B99-F9-CRACK01')
    expect(result.conclusion).toContain('档案')
    expect(result.candidates).toHaveLength(0)
  })

  it('楼栋不存在时说清楚是哪一栋没有', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask('9号实验楼裂缝测点怎么样')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('9号实验楼')
    // 不能把紧跟其后的"裂缝"一起算进楼栋名
    expect(result.conclusion).not.toContain('9号实验楼裂')
  })

  it('空库时点名楼栋也照实说没有这栋楼，不回退到预置示例', async () => {
    const h = await setupHarness({ buildings: [], floors: [], points: [], devices: [], baselines: [], rules: [], records: [], events: [] })
    const result = await h.ask('3号教学楼裂缝测点怎么样')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('没有「3号教学楼」这栋楼')
    expect(result.gaps.join('|')).toContain('不会退回预置示例')
  })

  it('没有线索的问句不会退化成随便挑一个点', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask('它怎么样')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('线索')
  })
})

describe('上下文沿用', () => {
  it('带上下文时，追问沿用该测点', async () => {
    const h = await setupHarness(campus())
    const result = await h.ask('它怎么样', { pointId: 'pnt_k3' })
    expect(result.status).toBe('not_found') // 无记录
    expect(result.conclusion).toContain('B03-F2-CRACK01')
    expect(result.dataNotes.join('\n')).toContain('沿用上一轮明确选定的测点')
  })

  it('数据集被替换后，旧上下文自动失效', async () => {
    const h = await setupHarness(campus())
    // 模拟"换了一份数据集"：清库后重写，原来的测点 id 不再存在
    const next = await setupHarness({
      buildings: [makeBuilding({ id: 'bld_x', code: 'B01', name: '1号综合楼' })],
      floors: [makeFloor({ id: 'flr_x', buildingId: 'bld_x' })],
      points: [makePoint({ id: 'pnt_new', code: 'B01-F2-CRACK01', buildingId: 'bld_x', floorId: 'flr_x' })],
      devices: [],
    })
    const result = await next.ask('它怎么样', { pointId: 'pnt_k3' })

    expect(result.status).toBe('not_found')
    expect(claims(result)).not.toContain('B03-F2-CRACK01')
    expect(next.archive.pointById('pnt_k3')).toBeUndefined()
  })
})

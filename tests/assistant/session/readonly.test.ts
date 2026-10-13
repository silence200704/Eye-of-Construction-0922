/**
 * 问筑瞳 · 只读纪律与数据更新。
 *
 * 两条线各守一件事：
 * 1. **一次提问不改变任何本地数据** —— 写入类指令只声明、不执行；
 * 2. **数据变了，重问就要变** —— 回答只读当前数据集，不吃缓存，也不回放上一轮结论。
 */
import { describe, expect, it } from 'vitest'
import { buildLink, pendingCommands } from '@/assistant/actions'
import { askZhutong } from '@/assistant/ask'
import type { AskLinkKind } from '@/assistant/types'
import { db } from '@/db/database'
import { makeEvent } from '../../fixtures'
import { NOW, record, setupHarness } from '../harness'

/** 所有表按主键排好序再序列化：用来做"数据一字未动"的整体比对。 */
async function dumpTables(): Promise<string> {
  const out: Record<string, unknown[]> = {}
  for (const table of db.tables) {
    const rows = (await table.toArray()) as { id?: string }[]
    out[table.name] = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }
  return JSON.stringify(out)
}

const QUESTIONS = ['全校现在监测如何', '二层走廊西墙裂缝测点怎么样', '为什么这条是红色', '列出还没处理的预警', '照片有变化吗', '随便问点什么']

/**
 * 与 `src/router/index.ts` 的路由表对应：助手只允许指向这些页面。
 * 新增页面时同步这里；页面改名而这里没改，这条用例就会红。
 */
const ROUTE_PATHS = ['/', '/campus', '/archive', '/monitor', '/alarms', '/trend', '/media', '/inspection', '/issues', '/maintenance', '/reports', '/standards', '/settings']

describe('问答不写库', () => {
  it('问过一遍所有固定问法后，本地表一字未动', async () => {
    const h = await setupHarness({
      records: [record({ id: 'r1', recordNo: 'R20260920-001', sampleTime: '2026-09-20T11:00:00.000Z' })],
      events: [makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red' })],
    })
    const before = await dumpTables()

    for (const question of QUESTIONS) {
      await h.ask(question)
    }
    await h.ask('准备一次红色预警演示')

    expect(await dumpTables()).toBe(before)
  })

  it('空数据集上提问也不会顺带把示例数据写进去', async () => {
    const h = await setupHarness({ buildings: [], floors: [], points: [], devices: [], baselines: [], rules: [], records: [], events: [] })
    await h.ask('全校现在监测如何')
    expect(await db.buildings.count()).toBe(0)
    expect(await db.points.count()).toBe(0)
    expect(await db.rules.count()).toBe(0)
    expect(await db.audits.count()).toBe(0)
  })

  it('演示数据问法只导航到系统设置，提问本身不写库', async () => {
    const h = await setupHarness()
    const result = await h.ask('准备一次红色预警演示')

    expect(result.status).toBe('answered')
    expect(result.conclusion).toContain('系统设置')
    expect(result.pendingCommands).toEqual([])
    expect(result.links.map((row) => row.path)).toEqual(['/settings'])
  })

  it('待确认指令清单是副本，调用方改不动它', () => {
    const first = pendingCommands()
    first[0].enabled = true
    expect(pendingCommands()[0].enabled).toBe(false)
  })

  it('未登记的导航种类直接拒绝，杜绝任意命令执行', () => {
    expect(() => buildLink('drop_database' as AskLinkKind)).toThrow('未登记的动作')
  })

  it('导航链接落在现有页面路径上，并且带上了对象 ID', async () => {
    const h = await setupHarness({
      records: [record({ id: 'r1', recordNo: 'R20260920-001', sampleTime: '2026-09-20T11:00:00.000Z' })],
      events: [makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red' })],
    })
    const result = await h.ask('为什么这条是红色', { eventId: 'e1' })

    // /alarms?event=<id> 与 /reports/event/<id> 是现有页面已经在解析的深链
    expect(result.links.find((row) => row.kind === 'event_detail')?.query.event).toBe('e1')
    expect(result.links.find((row) => row.kind === 'event_report')?.path).toBe('/reports/event/e1')
    expect(result.links.find((row) => row.kind === 'point_building')?.query.b).toBe('bld_1')
    expect(result.links.find((row) => row.kind === 'alarm_queue')?.query.scope).toBe('unclosed')
    // 3D 定位要带全"楼栋 + 楼层 + 测点"，页面才进得去同一层同一个标记
    const spatial = result.links.find((row) => row.kind === 'spatial_3d')
    expect(spatial?.path).toBe('/campus')
    expect(spatial?.query.view).toBe('3d')
    expect(spatial?.query.b).toBe('bld_1')
    expect(spatial?.query.f).toBe('flr_1')
    expect(spatial?.query.point).toBe('pnt_1')

    for (const link of result.links) {
      expect(ROUTE_PATHS.some((path) => link.path === path || link.path.startsWith(`${path}/`))).toBe(true)
    }
  })

  it('影像类问法已接入：没有影像时说清缺什么，不给别的答案顶上', async () => {
    const h = await setupHarness()
    const result = await h.ask('照片有变化吗')
    expect(result.intent).toBe('media_compare')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('没有可对比的影像')
    expect(result.gaps.join('\n')).toContain('影像对比页')
  })

  it('完全认不出的问句给可问示例，不硬套意图', async () => {
    const h = await setupHarness()
    for (const question of ['今天天气怎么样', '把服务器重启一下']) {
      const result = await h.ask(question)
      expect(result.intent).toBe('unknown')
      expect(result.status).toBe('unsupported')
      expect(result.gaps.join('\n')).toContain('全校现在监测如何')
    }
  })

  it('提到测点但没有任何线索时，说明缺线索而不是硬挑一个点', async () => {
    const h = await setupHarness()
    const result = await h.ask('测点怎么样')
    expect(result.intent).toBe('point_status')
    expect(result.status).toBe('not_found')
    expect(result.conclusion).toContain('线索')
  })

  it('空问题不报错，返回示例问法', async () => {
    await setupHarness()
    const result = await askZhutong('   ')
    expect(result.status).toBe('unsupported')
    expect(result.gaps.join('\n')).toContain('3号教学楼裂缝测点怎么样')
  })

  it('提问不推进共享时钟：刻度只由界面的「刷新数据」推进', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const before = h.clock.nowKey
    expect(before).toBe(NOW)

    for (const question of QUESTIONS) await h.ask(question)
    expect(h.clock.nowKey).toBe(before)

    // 只有显式刷新才让刻度前进，且前进后重问才拿到新的时间口径
    h.clock.refresh()
    expect(h.clock.nowKey).not.toBe(before)
    const after = await h.ask('二层走廊西墙裂缝测点怎么样')
    expect(after.computedAt).toBe(h.clock.nowKey)
  })
})

describe('数据更新后重新提问', () => {
  it('新增一条有效记录后，同一句话给出新的读数', async () => {
    const h = await setupHarness({
      records: [record({ id: 'r1', recordNo: 'R20260920-001', sampleTime: '2026-09-20T09:00:00.000Z', values: { width: 0.52 } })],
    })
    const question = '二层走廊西墙裂缝测点怎么样'
    const before = await h.ask(question)
    expect(before.conclusion).toContain('0.52')

    await db.records.put(
      record({ id: 'r2', recordNo: 'R20260920-002', sampleTime: '2026-09-20T11:45:00.000Z', values: { width: 0.73 } }),
    )
    await h.records.reload()

    const after = await h.ask(question)
    expect(after.conclusion).toContain('0.73')
    expect(after.conclusion).not.toContain('0.52')
    expect(after.evidence.map((row) => row.ref)).toContain('R20260920-002')
    expect(after.timing?.freshness).toBe('current')
  })

  it('新增记录后，全校概况的计数与更新时间同步变化', async () => {
    const h = await setupHarness({ records: [] })
    const before = await h.ask('全校现在监测如何')
    expect(before.facts.map((row) => `${row.label}=${row.value}`)).toContain('有有效读数的传感器测点=0 / 1')

    await db.records.put(record({ id: 'r1', recordNo: 'R20260920-001', sampleTime: '2026-09-20T11:00:00.000Z' }))
    await h.records.reload()

    const after = await h.ask('全校现在监测如何')
    const facts = after.facts.map((row) => `${row.label}=${row.value}`).join('\n')
    expect(facts).toContain('有有效读数的传感器测点=1 / 1')
    expect(facts).toContain('最近一次采样时间=2026-09-20 19:00')
  })

  it('事件被关闭后，未处理队列的计数同步变化', async () => {
    const h = await setupHarness({
      events: [makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red' })],
    })
    const before = await h.ask('列出还没处理的预警')
    expect(before.conclusion).toContain('1 条未关闭预警')

    await db.events.put(makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red', status: 'closed', closedAt: NOW, closedBy: '安全管理员' }))
    await h.events.reload()

    const after = await h.ask('列出还没处理的预警')
    expect(after.conclusion).toContain('没有任何未关闭的预警事件')
  })

  it('演示载入后记录时间与新鲜度一起推进（不啃上一轮结论）', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-18T09:00:00.000Z' })] })
    const stale = await h.ask('二层走廊西墙裂缝测点怎么样')
    expect(stale.timing?.freshness).toBe('stale')

    // 演示脚本载入的新数据：采样时间靠近当前刻度
    await db.records.put(record({ id: 'r2', recordNo: 'R20260920-009', sampleTime: '2026-09-20T11:50:00.000Z' }))
    await h.records.reload()

    const fresh = await h.ask('二层走廊西墙裂缝测点怎么样')
    expect(fresh.timing?.freshness).toBe('current')
  })
})

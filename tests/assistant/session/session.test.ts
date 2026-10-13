/**
 * 问筑瞳 · 半屏会话状态。
 *
 * 守三件事：
 * 1. 从测点卡 / 事件详情唤起时**带上对象上下文**，并立刻问一句默认问法；
 * 2. 候选点选后带着对象 ID 重问；
 * 3. 「刷新数据」是唯一推进共享时钟的时机，且推进后重问能拿到新的数字。
 */
import { describe, expect, it, vi } from 'vitest'
import { ENTRY_BURST_MS, useAssistantStore } from '@/assistant/session'
import { answerSections } from '@/components/assistant/reveal/useAnswerReveal'
import { ASK_EXAMPLES } from '@/assistant'
import { db } from '@/db/database'
import { makeEvent, makeFloor, makePoint } from '../../fixtures'
import { NOW, claims, record, setupHarness } from '../harness'

describe('唤起与上下文', () => {
  it('从测点卡唤起：带上下文并立刻问一句，回答沿用该测点', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z', values: { width: 0.52 } })] })
    const assistant = useAssistantStore()
    expect(assistant.open).toBe(false)

    await assistant.openWith('point', 'pnt_1', 'B01-F2-CRACK01 二层走廊西墙裂缝测点')

    expect(assistant.open).toBe(true)
    expect(assistant.contextLabel).toContain('B01-F2-CRACK01')
    expect(assistant.turns).toHaveLength(1)
    expect(assistant.turns[0].question).toBe('它怎么样')
    expect(claims(assistant.turns[0].result!)).toContain('B01-F2-CRACK01')
    expect(assistant.turns[0].result?.dataNotes.join('\n')).toContain('沿用上一轮明确选定的测点')
    expect(h.clock.nowKey).toBe(NOW)
  })

  it('从事件详情唤起：问的是这条事件为什么', async () => {
    await setupHarness({
      records: [record({ id: 'r1', recordNo: 'R20260920-001', sampleTime: '2026-09-20T11:00:00.000Z' })],
      events: [makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red' })],
    })
    const assistant = useAssistantStore()
    await assistant.openWith('event', 'e1', 'E20260920-001（红色紧急核查）')

    expect(assistant.turns[0].question).toBe('为什么这条是红色')
    expect(assistant.turns[0].result?.intent).toBe('event_reason')
    expect(claims(assistant.turns[0].result!)).toContain('E20260920-001')
  })

  it('上下文对象在数据集里消失后，提示重新选择并清掉旧上下文', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const assistant = useAssistantStore()
    await assistant.openWith('point', 'pnt_1', 'B01-F2-CRACK01 二层走廊西墙裂缝测点')

    // 模拟"换了一份数据集"：清库重写，原来的测点 id 不再存在
    await db.records.clear()
    await db.points.clear()
    await h.archive.reload()
    await h.records.reload()

    await assistant.ask('它怎么样')

    const latest = assistant.turns[assistant.turns.length - 1].result!
    expect(latest.status).toBe('not_found')
    expect(latest.conclusion).toContain('已不在当前数据集')
    expect(latest.conclusion).toContain('请重新选择')
    // 失效上下文不留在会话里，免得后续每一问都拿着一个不存在的对象
    expect(assistant.context).toEqual({})
  })

  it('候选点选后带着对象 ID 重问', async () => {
    await setupHarness({
      floors: [makeFloor({ floorNo: 1, name: '一层' })],
      points: [
        // 三个同名测点，靠编号区分
        makePoint({ id: 'p1', code: 'B01-F1-CHECK01', name: '一层走廊人工检查点', metric: 'inspection', type: 'manual_check' }),
        makePoint({ id: 'p2', code: 'B02-F1-CHECK01', name: '一层走廊人工检查点', metric: 'inspection', type: 'manual_check' }),
        makePoint({ id: 'p3', code: 'B03-F1-CHECK01', name: '一层走廊人工检查点', metric: 'inspection', type: 'manual_check' }),
      ],
      devices: [],
      records: [],
    })
    const assistant = useAssistantStore()
    await assistant.ask('一层走廊人工检查点怎么样')
    const first = assistant.turns[0].result!
    expect(first.status).toBe('need_choice')
    expect(first.candidates).toHaveLength(3)

    await assistant.chooseCandidate(first.candidates[2], '一层走廊人工检查点怎么样')

    expect(assistant.context.pointId).toBe('p3')
    expect(assistant.contextLabel).toContain('B03-F1-CHECK01')
    const second = assistant.turns[1].result!
    expect(second.conclusion).toContain('B03-F1-CHECK01')
  })
})

describe('刷新与状态', () => {
  it('展示进度只属于当前一问；旧回答标记完成后不会在重开时重播', async () => {
    await setupHarness()
    const assistant = useAssistantStore()
    await assistant.ask('准备一次红色预警演示')
    const first = assistant.turns[0]
    expect(first.presented).toBe(false)
    expect(answerSections(first.result!)).toEqual(['summary', 'limits', 'links'])
    assistant.markPresented(first.id)
    expect(assistant.turns[0].presented).toBe(true)

    await assistant.ask('全校现在监测如何')
    expect(assistant.turns[0].presented).toBe(true)
    expect(assistant.turns[1].presented).toBe(false)
    expect(answerSections(assistant.turns[1].result!)[0]).toBe('summary')
  })

  it('普通提问不推进时钟；刷新推进并让数字跟着数据变', async () => {
    const h = await setupHarness({
      records: [record({ id: 'r1', recordNo: 'R20260920-001', sampleTime: '2026-09-20T09:00:00.000Z', values: { width: 0.52 } })],
    })
    const assistant = useAssistantStore()
    await assistant.ask('二层走廊西墙裂缝测点怎么样')
    expect(assistant.turns[0].result?.conclusion).toContain('0.52')
    expect(h.clock.nowKey).toBe(NOW)

    // 新数据落库（样例：演示载入或手工录入）
    await db.records.put(record({ id: 'r2', recordNo: 'R20260920-002', sampleTime: '2026-09-20T12:30:00.000Z', values: { width: 0.82 } }))
    await h.records.reload()

    await assistant.refresh()

    expect(h.clock.nowKey).not.toBe(NOW)
    expect(assistant.turns).toHaveLength(2)
    expect(assistant.turns[1].question).toBe('二层走廊西墙裂缝测点怎么样')
    expect(assistant.turns[1].result?.conclusion).toContain('0.82')
    expect(assistant.notice).toContain('已按当前时刻重新读取数据')
  })

  it('还没有问过任何问题时，刷新只推进时钟并说明下一步', async () => {
    const h = await setupHarness()
    const assistant = useAssistantStore()
    await assistant.refresh()
    expect(assistant.turns).toHaveLength(0)
    expect(assistant.notice).toContain('先问一句')
    expect(h.clock.nowKey).not.toBe(NOW)
  })

  it('小瞳状态由会话推导：待机 → 检索中 → 找到证据 / 无数据', async () => {
    await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const assistant = useAssistantStore()
    expect(assistant.mascotState).toBe('idle')

    const pending = assistant.ask('二层走廊西墙裂缝测点怎么样')
    expect(assistant.mascotState).toBe('searching')
    await pending
    expect(assistant.mascotState).toBe('found')

    await assistant.ask('B99-F9-CRACK01 怎么样')
    expect(assistant.mascotState).toBe('empty')
  })

  it('忙碌时忽略重复提交，不会写进两条相同的问题', async () => {
    await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const assistant = useAssistantStore()
    const first = assistant.ask('全校现在监测如何')
    await assistant.ask('全校现在监测如何')
    await first
    expect(assistant.turns).toHaveLength(1)
  })

  it('数据集被整体替换后清空会话，旧结论不与新数据并排', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const assistant = useAssistantStore()
    await assistant.ask('二层走廊西墙裂缝测点怎么样')
    expect(assistant.turns).toHaveLength(1)

    // 走真正的清空入口（与设置页「清空并转为空白模式」同一条路）
    await h.archive.clearAll('验收：模拟切换数据集')
    await assistant.ask('全校现在监测如何')

    expect(assistant.turns).toHaveLength(1)
    expect(assistant.turns[0].question).toBe('全校现在监测如何')
    expect(assistant.turns[0].result?.conclusion).toContain('0 栋在册楼栋')
    expect(assistant.notice).toContain('数据集已切换')
    expect(assistant.context).toEqual({})
  })

  it('入口状态：检索中持续，找到答案只亮一下随后回待机', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
      const assistant = useAssistantStore()
      expect(assistant.entryState).toBe('idle')

      const pending = assistant.ask('二层走廊西墙裂缝测点怎么样')
      expect(assistant.entryState).toBe('searching')
      await pending
      // 有结果后先闪一下
      expect(assistant.entryState).toBe('found')

      // 过了反馈时长就回待机 —— 入口不会永远停在 found 上静止
      vi.advanceTimersByTime(ENTRY_BURST_MS + 10)
      expect(assistant.entryState).toBe('idle')
      // 语义状态仍然留在面板那头
      expect(assistant.mascotState).toBe('found')
    } finally {
      vi.useRealTimers()
    }
  })

  it('入口状态：无数据同样只压暗一会儿', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await setupHarness({ records: [] })
      const assistant = useAssistantStore()
      await assistant.ask('B99-F9-CRACK01 怎么样')
      expect(assistant.entryState).toBe('empty')
      vi.advanceTimersByTime(ENTRY_BURST_MS + 10)
      expect(assistant.entryState).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })

  it('清空对话与清除上下文是两个独立出口', async () => {
    await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const assistant = useAssistantStore()
    await assistant.openWith('point', 'pnt_1', 'B01-F2-CRACK01 二层走廊西墙裂缝测点')
    assistant.clearTurns()
    expect(assistant.turns).toHaveLength(0)
    expect(assistant.context.pointId).toBe('pnt_1')
    assistant.clearContext()
    expect(assistant.context).toEqual({})
    expect(assistant.contextLabel).toBe('')
  })

  it('固定问法示例可直接用于提问', async () => {
    await setupHarness({ records: [record({ id: 'r1', sampleTime: '2026-09-20T11:00:00.000Z' })] })
    const assistant = useAssistantStore()
    for (const question of ASK_EXAMPLES) {
      await assistant.ask(question)
    }
    expect(assistant.turns.every((turn) => turn.result !== null)).toBe(true)
    expect(assistant.turns.map((turn) => turn.result?.intent)).toEqual([
      'campus_overview',
      'point_status',
      'event_reason',
      'open_events',
      'demo_guide',
      'visual_evidence',
      'visual_region',
      'visual_region',
    ])
  })
})

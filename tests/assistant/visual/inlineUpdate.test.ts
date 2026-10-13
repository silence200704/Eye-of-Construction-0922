/**
 * 视觉证据的会话行为：按需读取、就地更新、刷新后不偷换照片。
 *
 * 这一组守的是"界面上的操作口径"：
 * - 设置页那条场景**已就绪**时才按需读取内置素材，没就绪就只提示去哪儿准备；
 * - 区域切换/自己框选改的是**同一条回答**，不新增轮次；
 * - 会话影像没了以后，旧回答仍指着原来的照片 ID（界面上显示"已失效"），
 *   重新提问才会按需重新读取 —— 绝不静默换成别的图。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAssistantStore } from '@/assistant/session'
import { writeEntry } from '@/stores/demo/registry'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { useMediaStore } from '@/stores/media'
import { db } from '@/db/database'
import { record, setupHarness } from '../harness'
import { makePoint } from '../../fixtures'
import { ASK_EXAMPLES } from '@/assistant/answers'
import { visualExamples } from '@/assistant/answers/fallback'
import { lumaOfBlob } from '@/core/media/capture'

const SIZE = 40

vi.mock('@/core/media/capture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/media/capture')>()
  return {
    ...actual,
    decodeUpload: vi.fn(async (file: File) => ({ blob: file, width: SIZE, height: SIZE, size: file.size })),
    lumaOfBlob: vi.fn(async () => ({ data: new Float32Array(SIZE * SIZE).fill(100), width: SIZE, height: SIZE })),
  }
})

/** 把设置页那条视觉演示场景登记成"已就绪"，锚点指向当前数据集里的测点。 */
function markScenarioReady(pointId: string): void {
  writeEntry('mediaEvidence', {
    at: new Date().toISOString(),
    message: '视觉证据素材已就绪',
    failed: false,
    anchors: [{ kind: 'point', id: pointId }],
  })
}

beforeEach(async () => {
  localStorage.removeItem('zhutong-demo/demo-registry')
  setActivePinia(createPinia())
  await setupHarness({ records: [record({ id: 'r1', recordNo: 'R20260920-001', values: { width: 0.53 } })] })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['photo'], { type: 'image/jpeg' }))))
})

describe('视觉证据的按需读取', () => {
  it.each(visualExamples('B01-F2-CRACK01'))('预设问法可直接得到视觉证据卡：%s', async (question) => {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask(question)
    const card = assistant.last?.result?.previews[0]
    expect(card?.kind).toBe('visual_evidence')
    if (card?.kind !== 'visual_evidence') return
    expect(card.pair?.pointId).toBe('pnt_1')
    if (question.includes('完好')) expect(card.active).toBe('control')
    if (question.includes('放大')) expect(card.zoom).toBe(true)
    expect(await db.attachments.count()).toBe(0)
  })

  it('影像预览入口只提指定的视觉问题，不先追加一轮默认测点回答', async () => {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    const assistant = useAssistantStore()
    await assistant.openWith('point', 'pnt_1', '裂缝测点', visualExamples('B01-F2-CRACK01')[0])
    expect(assistant.open).toBe(true)
    expect(assistant.turns).toHaveLength(1)
    expect(assistant.last?.result?.previews[0]?.kind).toBe('visual_evidence')
  })

  it('默认推荐测点不存在时不借用另一个楼栋的裂缝测点', async () => {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    await useAssistantStore().ask(ASK_EXAMPLES[5])
    expect(useAssistantStore().last?.result?.status).toBe('not_found')
    expect(useMediaStore().frames).toHaveLength(0)
  })

  it('场景未就绪：不去读素材，只提示到系统设置准备', async () => {
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask('这面墙的裂缝有什么变化？')
    const result = assistant.turns[0].result
    expect(result?.previews).toEqual([])
    expect(result?.gaps.join('\n')).toContain('系统设置')
    expect(useMediaStore().frames).toHaveLength(0)
  })

  it('场景已就绪：提问时按需读取内置素材，成对进入会话并标明来源', async () => {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask('这面墙的裂缝有什么变化？')

    const card = assistant.turns[0].result?.previews[0]
    expect(card?.kind).toBe('visual_evidence')
    if (card?.kind !== 'visual_evidence') return
    expect(card.source).toBe('builtin')
    expect(card.pair?.source).toBe('builtin')
    expect(card.note).toContain('非真实连续拍摄')
    expect(useMediaStore().framesOf('pnt_1').map((row) => row.origin)).toEqual(['demo_evidence', 'demo_evidence'])
    // 素材是会话影像：库里不能多出任何附件
    expect(await db.attachments.count()).toBe(0)
  })

  it('锚点测点被删掉后场景判失效，不再按需读取', async () => {
    markScenarioReady('pnt_other')
    await useDemoScenarioStore().refresh()
    expect(useDemoScenarioStore().stateOf('mediaEvidence').ready).toBe(false)
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask('这面墙的裂缝有什么变化？')
    expect(useMediaStore().frames).toHaveLength(0)
  })

  it('素材场景就绪也不能把同一对图借给未登记的另一个测点', async () => {
    await setupHarness({ points: [makePoint(), makePoint({ id: 'pnt_2', code: 'B01-F2-CRACK02' })] })
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_2' }
    await assistant.ask('给我看数据和照片。')
    expect(useMediaStore().frames).toHaveLength(0)
    expect(assistant.turns[0].result?.status).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('已有单张用户照片时如实显示缺图，不自动补演示素材盖过用户选择', async () => {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    useMediaStore().addUpload({ pointId: 'pnt_1', capturedAt: '2026-09-20T09:00:00Z', label: '现场',
      fileName: 'user.jpg', width: SIZE, height: SIZE, blob: new Blob(['user']) })
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask('给我看数据和照片。')
    expect(useMediaStore().frames).toHaveLength(1)
    expect(assistant.turns[0].result?.conclusion).toContain('缺少可比影像')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('区域切换只更新同一条回答', () => {
  async function withCard(): Promise<ReturnType<typeof useAssistantStore>> {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask('这面墙的裂缝有什么变化？')
    return assistant
  }

  it('切到完好墙面：不新增轮次，回答里的区域与结论一起变', async () => {
    const assistant = await withCard()
    const id = assistant.turns[0].id
    const before = assistant.turns[0].result?.previews[0]
    if (before?.kind !== 'visual_evidence') return
    const photos = [before.pair?.beforeId ?? '', before.pair?.afterId ?? '']
    expect(assistant.turns).toHaveLength(1)

    await assistant.applyVisual(id, { kind: 'region', key: 'control' })

    expect(assistant.turns).toHaveLength(1)
    const card = assistant.turns[0].result?.previews[0]
    expect(card?.kind).toBe('visual_evidence')
    if (card?.kind !== 'visual_evidence') return
    expect(card.active).toBe('control')
    expect(card.results.crack).not.toBeNull()
    expect(card.results.control).not.toBeNull()
    expect(assistant.notice).toContain('没有新增一轮')
    // 换区域不动照片：前后两张还是同一对
    expect([card.pair?.beforeId ?? '', card.pair?.afterId ?? '']).toEqual(photos)
  })

  it('自己框选：按新的自定义区域算一次，结果绑定同一对照片', async () => {
    const assistant = await withCard()
    const id = assistant.turns[0].id
    await assistant.applyVisual(id, { kind: 'custom', region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } })

    const card = assistant.turns[0].result?.previews[0]
    if (card?.kind !== 'visual_evidence') return
    expect(card.active).toBe('custom')
    expect(card.results.custom?.region).toEqual({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 })
    expect(card.results.custom?.beforeId).toBe(card.pair?.beforeId)
    expect(assistant.turns).toHaveLength(1)
  })

  it('影像页选择另一对照片后，旧回答切区域仍固定原照片ID', async () => {
    const assistant = await withCard()
    const original = assistant.turns[0].result?.previews[0]
    if (original?.kind !== 'visual_evidence' || original.pair === null) throw new Error('缺少照片卡')
    const media = useMediaStore()
    const userFrames = ['a', 'b'].map((name) => media.addUpload({
      pointId: 'pnt_1', capturedAt: `2026-09-2${name === 'a' ? '1' : '2'}T09:00:00Z`, label: name,
      fileName: `${name}.jpg`, width: SIZE, height: SIZE, blob: new Blob([name]),
    }))
    await media.runCompare({ pointId: 'pnt_1', beforeId: userFrames[0].id, afterId: userFrames[1].id,
      region: { x: 0, y: 0, w: 1, h: 1 } })
    await assistant.applyVisual(assistant.turns[0].id, { kind: 'region', key: 'control' })
    const updated = assistant.turns[0].result?.previews[0]
    if (updated?.kind !== 'visual_evidence') throw new Error('照片卡被替换')
    expect(updated.pair).toEqual(original.pair)
    expect(updated.results.control?.beforeId).toBe(original.pair.beforeId)
    expect(updated.results.control?.afterId).toBe(original.pair.afterId)
    expect(media.compare?.beforeId).toBe(userFrames[0].id)
  })

  it('对没有视觉卡的回答调用区域操作：什么也不做，不报错', async () => {
    const h = await setupHarness({ records: [record({ id: 'r1', recordNo: 'R20260920-001' })] })
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask('二层走廊西墙裂缝测点怎么样')
    const before = assistant.turns[0].result
    await assistant.applyVisual(assistant.turns[0].id, { kind: 'region', key: 'control' })
    expect(assistant.turns[0].result).toBe(before)
    expect(h.clock.nowKey).not.toBe('')
  })

  it('区域重算尚未结束时清空对话，旧结果及提示不会回填', async () => {
    const assistant = await withCard()
    let release!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(lumaOfBlob).mockImplementationOnce(async () => {
      await paused
      return { data: new Float32Array(SIZE * SIZE).fill(100), width: SIZE, height: SIZE }
    })
    const request = assistant.applyVisual(assistant.turns[0].id, { kind: 'region', key: 'control' })
    assistant.clearTurns()
    release()
    await request
    expect(assistant.turns).toEqual([])
    expect(assistant.notice).toBe('')
    expect(assistant.busy).toBe(false)
  })
})

describe('追问沿用上一条回答讲的测点', () => {
  it('视觉回答之后问「读数恢复了吗」，落在同一个测点上', async () => {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    const assistant = useAssistantStore()
    // 第一问靠"裂缝"这个指标线索定到测点，没有先给上下文
    await assistant.ask('这面墙的裂缝有什么变化？')
    expect(assistant.turns[0].result?.pointId).toBe('pnt_1')
    expect(assistant.context.pointId).toBe('pnt_1')

    // 第二问没有任何线索：应沿用上一条回答讲的测点，而不是回一句"没线索"
    await assistant.ask('读数恢复了吗？')
    const second = assistant.turns[1].result
    expect(second?.intent).toBe('reading_recovery')
    expect(second?.pointId).toBe('pnt_1')
    expect(second?.facts.map((row) => row.value).join('|')).toContain('B01-F2-CRACK01')
  })

  it('「带我到 3D 看位置」同样沿用同一条回答的测点', async () => {
    const assistant = useAssistantStore()
    await assistant.ask('二层走廊西墙裂缝测点怎么样')
    await assistant.ask('带我到 3D 看位置。')
    const result = assistant.turns[1].result
    expect(result?.intent).toBe('spatial_go')
    expect(result?.links.find((row) => row.kind === 'spatial_3d')?.query.point).toBe('pnt_1')
  })
})

describe('会话影像失效后不偷换照片', () => {
  it('清掉会话影像后旧回答仍指向原来的照片；重新提问才按需重读', async () => {
    markScenarioReady('pnt_1')
    await useDemoScenarioStore().refresh()
    const assistant = useAssistantStore()
    assistant.context = { pointId: 'pnt_1' }
    await assistant.ask('这面墙的裂缝有什么变化？')
    const card = assistant.turns[0].result?.previews[0]
    if (card?.kind !== 'visual_evidence') return
    const beforeId = card.pair?.beforeId ?? ''
    expect(beforeId).not.toBe('')

    useMediaStore().clearPoint('pnt_1')
    // 旧回答里的照片 ID 原样保留：界面上显示"这组会话影像已失效"，不会偷偷换成别的图
    const still = assistant.turns[0].result?.previews[0]
    if (still?.kind !== 'visual_evidence') return
    expect(still.pair?.beforeId).toBe(beforeId)

    const previousResult = assistant.turns[0].result
    vi.mocked(fetch).mockClear()
    await assistant.applyVisual(assistant.turns[0].id, { kind: 'region', key: 'control' })
    expect(assistant.turns[0].result).toBe(previousResult)
    expect(assistant.notice).toContain('影像已失效')
    expect(useMediaStore().frames).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()

    await assistant.ask('这面墙的裂缝有什么变化？')
    const fresh = assistant.turns[1].result?.previews[0]
    if (fresh?.kind !== 'visual_evidence') return
    expect(fresh.pair?.beforeId).not.toBe(beforeId)
  })
})

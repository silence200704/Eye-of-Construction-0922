import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setup, authorize, tables } from './harness'
import { P_CRACK, P_TILT } from '@/db/seedFactories'
import { runDirector } from '@/assistant/director/task'
import { directorIntent } from '@/assistant/director/intent'
import { useMediaStore } from '@/stores/media'
import { askZhutong } from '@/assistant/ask'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { useClockStore } from '@/stores/clock'

vi.mock('@/core/media/video', () => ({
  loadVideoMeta: vi.fn(async (_url: string, fileName: string) => ({ video: {}, meta: { durationSeconds: 12, width: 960, height: 720, fileName } })),
  releaseVideo: vi.fn(),
  extractKeyframes: vi.fn(async () => [3, 6, 9].map((timeCode, index) => ({ index, timeCode, blob: new Blob([String(timeCode)]), width: 480, height: 360 }))),
}))
vi.mock('@/core/media/analysis', () => ({
  analysePair: vi.fn(async () => [{ status: 'changed', summary: '疑似变化', changedRatio: 0.15 }, { status: 'stable', summary: '未见明显差异', changedRatio: 0 }]),
  compareRecordOf: vi.fn((input) => ({ ...input, ...input.result, comparedAt: 'now' })),
}))

beforeEach(setup)
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('分析上传视频沿用原文件，不需要登记预置视频且不偷换素材', async () => {
  authorize()
  const media = useMediaStore()
  await media.pickVideo(new File(['local-video'], '我的墙面.mp4', { type: 'video/mp4' }), P_CRACK)
  const id = media.videoMeta!.id
  const loader = vi.spyOn(media, 'loadBundledVideo')
  const before = await tables()
  const result = await runDirector({ question: '分析这段视频', context: { pointId: P_CRACK } })
  expect(result?.status).toBe('answered')
  expect(media.videoMeta!.id).toBe(id)
  expect(media.videoMeta!.assetKey).toBe('')
  expect(media.frames).toHaveLength(3)
  expect(loader).not.toHaveBeenCalled()
  expect(result?.conclusion).toContain('机位与拍摄时间未核实')
  expect(await tables()).toBe(before)
  const assistant = (await import('@/assistant/session')).useAssistantStore()
  await assistant.ask('分析这段视频', { pointId: P_CRACK })
  await assistant.refresh()
  expect(assistant.last?.result?.intent).toBe('video_compare')
  expect(media.videoMeta!.id).toBe(id)
  expect(loader).not.toHaveBeenCalled()
})

it.each(['视频变化和传感器读数一致吗', '为什么这段视频不能前后比对', '不要播放演示视频', '怎么提取视频关键帧'])('普通或否定问法不自动准备：%s', async (question) => {
  authorize()
  expect(directorIntent(question)).toBeNull()
  const fetcher = vi.spyOn(globalThis, 'fetch')
  const before = await tables()
  await askZhutong(question, { context: { pointId: P_CRACK } })
  expect(fetcher).not.toHaveBeenCalled()
  expect(await tables()).toBe(before)
})
it('播放演示视频是明确任务，无设置授权则只给唯一入口', async () => {
  expect(directorIntent('播放 B03-F2-CRACK01 的演示巡检视频')).toBe('video')
  const result = await runDirector({ question: '播放 B03-F2-CRACK01 的演示巡检视频', context: {} })
  expect(result?.status).toBe('not_found')
  expect(result?.links[0].path).toBe('/settings')
})
it('有会话授权但素材未登记或对象不匹配，不读取视频且业务库零变化', async () => {
  authorize()
  const loader = vi.spyOn(useMediaStore(), 'loadBundledVideo')
  const before = await tables()
  for (const pointId of [P_CRACK, P_TILT]) {
    const result = await runDirector({ question: '播放演示视频', context: { pointId } })
    expect(result?.status).toBe('not_found')
  }
  expect(loader).not.toHaveBeenCalled()
  expect(await tables()).toBe(before)
})

it('唯一入口登记后明确任务生成会话视频；重复任务复用且普通问答不写库不推进时钟', async () => {
  await useDemoScenarioStore().load('mediaEvidence')
  authorize()
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['video'])))
  const before = await tables()
  const clock = useClockStore().nowKey
  const first = await runDirector({ question: '播放 B03-F2-CRACK01 的演示巡检视频', context: {} })
  expect(first?.status).toBe('answered')
  expect(first?.pointId).toBe(P_CRACK)
  expect(first?.previews[0].kind).toBe('video_evidence')
  const ids = useMediaStore().frames.map((row) => row.id)
  await runDirector({ question: '对比 B03-F2-CRACK01 的视频首末关键帧', context: {} })
  expect(useMediaStore().frames.map((row) => row.id)).toEqual(ids)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const answer = await askZhutong('视频变化和传感器读数一致吗', { context: { pointId: P_CRACK } })
  expect(answer.facts.find((row) => row.label === '影像与数据关系')?.value).toContain('不能确认真实时序一致')
  expect(answer.links.find((row) => row.kind === 'spatial_3d')?.query.point).toBe(P_CRACK)
  expect(await tables()).toBe(before)
  expect(useClockStore().nowKey).toBe(clock)
})

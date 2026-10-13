import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMediaStore } from '@/stores/media'
import { extractKeyframes } from '@/core/media/video'

vi.mock('@/core/media/video', () => ({
  loadVideoMeta: vi.fn(async (_url: string, fileName: string) => ({ video: {}, meta: { durationSeconds: 12, width: 960, height: 720, fileName } })),
  releaseVideo: vi.fn(),
  extractKeyframes: vi.fn(async () => [3, 6, 9].map((timeCode, index) => ({ index, timeCode, blob: new Blob([String(timeCode)]), width: 480, height: 360 }))),
}))
vi.mock('@/core/media/analysis', () => ({
  analysePair: vi.fn(async () => [
    { status: 'changed', summary: '疑似变化', changedRatio: 0.15 },
    { status: 'stable', summary: '未见明显差异', changedRatio: 0 },
  ]),
  compareRecordOf: vi.fn((input) => ({ ...input, ...input.result, comparedAt: 'now' })),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['video']))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('视频会话的真实身份与边界', () => {
  it('重复请求复用视频和三个帧，不伪造拍摄时间', async () => {
    const media = useMediaStore()
    const video = await media.loadBundledVideo('point-a', 'change', () => {})
    expect(await media.captureKeyframes('point-a', '变化演示')).toBe(3)
    expect(await media.loadBundledVideo('point-a', 'change', () => {})).toEqual(video)
    expect(await media.captureKeyframes('point-a', '变化演示')).toBe(0)
    expect(media.frames.map((row) => row.timeCode)).toEqual([3, 6, 9])
    expect(media.frames.every((row) => row.capturedAt === video.loadedAt && row.videoId === video.id)).toBe(true)
  })
  it('跨测点抽帧被拒绝，不改现有帧', async () => {
    const media = useMediaStore()
    await media.loadBundledVideo('point-a', 'change', () => {})
    await expect(media.captureKeyframes('point-b', '错误归属')).rejects.toThrow('跨测点')
    expect(media.frames).toHaveLength(0)
  })
  it('容量超限时不覆盖原照片', async () => {
    const media = useMediaStore()
    for (let i = 0; i < 4; i++) media.addUpload({ pointId: 'point-a', capturedAt: 'now', label: 'photo', fileName: `${i}.jpg`, width: 10, height: 10, blob: new Blob(['photo']) })
    const original = media.frames.map((row) => row.id)
    await media.loadBundledVideo('point-a', 'change', () => {})
    await expect(media.captureKeyframes('point-a', '变化演示')).rejects.toThrow('6 张')
    expect(media.frames.map((row) => row.id)).toEqual(original)
  })
  it('解码完成后撤销授权不会提交新视频，旧视频保留', async () => {
    const media = useMediaStore()
    const old = await media.loadBundledVideo('point-a', 'change', () => {})
    let calls = 0
    await expect(media.loadBundledVideo('point-a', 'inspection', () => { if (++calls > 1) throw new Error('撤销') })).rejects.toThrow('撤销')
    expect(media.videoMeta?.id).toBe(old.id)
  })
  it('抽帧中切视频，拒绝提交旧结果', async () => {
    const media = useMediaStore()
    await media.loadBundledVideo('point-a', 'change', () => {})
    vi.mocked(extractKeyframes).mockImplementationOnce(async () => { media.clearVideo(); return [] })
    await expect(media.captureKeyframes('point-a', 'old')).rejects.toThrow('视频已切换')
    expect(media.frames).toHaveLength(0)
  })
  it('固定机位用共用分析，移动机位不给变化比例；两者都不覆盖照片结果', async () => {
    const media = useMediaStore()
    await media.loadBundledVideo('point-a', 'change', () => {})
    await media.captureKeyframes('point-a', '变化演示')
    const result = await media.analyseVideo()
    expect(result.regions.crack.changedRatio).toBe(0.15)
    expect(media.compare).toBeNull()
    const oldIds = result.frameIds
    await media.loadBundledVideo('point-a', 'inspection', () => {})
    expect(media.frames.some((row) => oldIds.includes(row.id))).toBe(false)
    await media.captureKeyframes('point-a', '公开实拍')
    const other = await media.analyseVideo()
    expect(other.regions).toEqual({})
    expect(other.reason).toContain('镜头移动')
    const frames = media.frames
    expect(await media.runCompare({ pointId: 'point-a', beforeId: frames[0].id, afterId: frames[2].id, region: { x: 0, y: 0, w: 1, h: 1 } })).toBeNull()
    expect(media.compare).toBeNull()
  })
  it('删除关键帧后旧分析不可再使用', async () => {
    const media = useMediaStore()
    await media.loadBundledVideo('point-a', 'change', () => {})
    await media.captureKeyframes('point-a', '变化演示')
    const result = await media.analyseVideo()
    media.removeFrame(result.frameIds[0])
    await expect(media.analyseVideo()).rejects.toThrow('三个关键帧')
  })
})

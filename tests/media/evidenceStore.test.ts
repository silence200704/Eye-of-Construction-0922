/**
 * 视觉证据素材的**会话侧契约**。
 *
 * 三件事在这里定死：
 * 1. 按需读取：素材随包提供、只在提问时读取，重复读不增加，也**不写任何业务表**；
 * 2. 区域对比：多个区域共用一次解码，结果是真算出来的（裂缝区变、对照区不变）；
 * 3. 不越界：小瞳的区域对比**不覆盖**影像页那条"最近一次预设分析"，也不跨测点借用影像。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMediaStore } from '@/stores/media'
import { db } from '@/db/database'
import type { FrameOrigin } from '@/types/media'

/** 40×40 的假亮度图：后一张在裂缝区（左上 20×20）里变亮 100，恰好 15% 的像素越线。 */
const SIZE = 40
const REGIONS = { crack: { x: 0, y: 0, w: 0.5, h: 0.5 }, control: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }

vi.mock('@/core/media/capture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/media/capture')>()
  return {
    ...actual,
    decodeUpload: vi.fn(async (file: File) => ({ blob: file, width: SIZE, height: SIZE, size: file.size })),
    // 用 blob 的内容当标记：真实像素口径由 tests/media/evidenceMaterials.test.ts 守
    lumaOfBlob: vi.fn(async (blob: Blob) => {
      const tag = await blob.text()
      const data = new Float32Array(SIZE * SIZE).fill(100)
      // 只改裂缝区（左上 20×20）里的前 3 行：60/400 = 15%，超过 8% 阈值
      if (tag.includes('after')) {
        for (let y = 0; y < 3; y += 1) for (let x = 0; x < 20; x += 1) data[y * SIZE + x] = 200
      }
      return { data, width: SIZE, height: SIZE }
    }),
  }
})

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['before'], { type: 'image/jpeg' }))))
})

function addFrame(pointId: string, origin: FrameOrigin, tag: string, fileName: string): string {
  useMediaStore().frames.push({
    id: `media_${tag}_${fileName}`,
    pointId,
    origin,
    capturedAt: '2026-09-30T09:00:00.000Z',
    label: tag,
    fileName,
    size: 8,
    width: SIZE,
    height: SIZE,
    blob: new Blob([tag], { type: 'image/jpeg' }),
    timeCode: null,
  })
  return `media_${tag}_${fileName}`
}

describe('按需读取视觉证据素材', () => {
  it('成对加入，重复读取不增加，也不写业务表', async () => {
    const media = useMediaStore()
    const counts = async (): Promise<number[]> => [
      await db.attachments.count(),
      await db.events.count(),
      await db.audits.count(),
    ]
    const before = await counts()

    expect(await media.loadEvidencePair('point-a')).toBe(2)
    const frames = media.framesOf('point-a')
    expect(frames).toHaveLength(2)
    expect(frames.map((row) => row.origin)).toEqual(['demo_evidence', 'demo_evidence'])
    expect(frames.every((row) => row.label.length > 0)).toBe(true)
    expect(media.message).toContain('基于实拍素材的变化演示')

    expect(await media.loadEvidencePair('point-a')).toBe(0)
    expect(media.framesOf('point-a')).toHaveLength(2)
    expect(await counts()).toEqual(before)
  })

  it('同一张图已经作为公开参考图时顶替它，不让同一张照片带两个来源标签', async () => {
    const media = useMediaStore()
    addFrame('point-a', 'demo_public', 'public', 'commons-crack-example.jpg')
    expect(await media.loadEvidencePair('point-a')).toBe(2)
    const frames = media.framesOf('point-a')
    expect(frames.filter((row) => row.origin === 'demo_public')).toHaveLength(0)
    expect(frames).toHaveLength(2)
  })

  it('会话影像已达上限时拒绝读取，并提示先去清理', async () => {
    const media = useMediaStore()
    for (let i = 0; i < 5; i += 1) addFrame('point-a', 'upload', `u${i}`, `u${i}.jpg`)
    expect(await media.loadEvidencePair('point-a')).toBe(0)
    expect(media.framesOf('point-a')).toHaveLength(5)
    expect(media.tone).toBe('bad')
  })

  it('测点为空时不读素材', async () => {
    const media = useMediaStore()
    expect(await media.loadEvidencePair('')).toBe(0)
    expect(media.frames).toHaveLength(0)
  })
})

describe('多区域对比', () => {
  function ready() {
    const media = useMediaStore()
    const beforeId = addFrame('point-a', 'demo_evidence', 'before', 'commons-crack-example.jpg')
    const afterId = addFrame('point-a', 'demo_evidence', 'after', 'commons-crack-evidence-simulated.jpg')
    return { media, beforeId, afterId }
  }

  it('裂缝区判「疑似变化」、对照区判「未见明显差异」，各自带上自己的区域与时间', async () => {
    const { media, beforeId, afterId } = ready()
    const out = await media.analyseRegions({
      pointId: 'point-a',
      beforeId,
      afterId,
      regions: [
        { key: 'crack', region: REGIONS.crack },
        { key: 'control', region: REGIONS.control },
      ],
    })

    expect(out?.crack.status).toBe('changed')
    expect(out?.crack.changedRatio).toBeCloseTo(60 / 400, 5)
    expect(out?.crack.region).toEqual(REGIONS.crack)
    expect(out?.crack.beforeId).toBe(beforeId)
    expect(out?.crack.comparedAt).not.toBe('')
    expect(out?.control.status).toBe('stable')
    expect(out?.control.changedRatio).toBe(0)
  })

  it('不覆盖影像页那条"最近一次预设分析"', async () => {
    const { media, beforeId, afterId } = ready()
    media.compare = {
      pointId: 'point-a',
      beforeId,
      afterId,
      region: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      status: 'stable',
      summary: '影像页自己跑的那次',
      changedRatio: 0,
      comparedAt: '2026-09-30T08:00:00.000Z',
    }
    await media.analyseRegions({ pointId: 'point-a', beforeId, afterId, regions: [{ key: 'crack', region: REGIONS.crack }] })
    expect(media.compare?.summary).toBe('影像页自己跑的那次')
  })

  it('跨测点、同一张图、公开参考图一律拒绝', async () => {
    const { media, beforeId, afterId } = ready()
    const other = addFrame('point-b', 'demo_evidence', 'before', 'other.jpg')

    expect(await media.analyseRegions({ pointId: 'point-a', beforeId, afterId: other, regions: [{ key: 'crack', region: REGIONS.crack }] })).toBeNull()
    expect(await media.analyseRegions({ pointId: 'point-a', beforeId, afterId: beforeId, regions: [{ key: 'crack', region: REGIONS.crack }] })).toBeNull()

    const publicId = addFrame('point-a', 'demo_public', 'public', 'reference.jpg')
    expect(await media.analyseRegions({ pointId: 'point-a', beforeId: publicId, afterId, regions: [{ key: 'crack', region: REGIONS.crack }] })).toBeNull()
  })

  it('影像被移除后再算同一区域：取不到帧就如实失败，不拿别的图顶上', async () => {
    const { media, beforeId, afterId } = ready()
    media.removeFrame(afterId)
    expect(await media.analyseRegions({ pointId: 'point-a', beforeId, afterId, regions: [{ key: 'crack', region: REGIONS.crack }] })).toBeNull()
  })
})


import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMediaStore } from '@/stores/media'
import { db } from '@/db/database'

vi.mock('@/core/media/capture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/media/capture')>()
  return {
    ...actual,
    decodeUpload: vi.fn(async (file: File) => ({
      blob: file,
      width: 640,
      height: 480,
      size: file.size,
    })),
    // 比对要解码位图；单测里给一份可用的假亮度序列，真实像素由 demoMaterials.test.ts 守
    lumaOfBlob: vi.fn(async () => ({ data: new Uint8ClampedArray([10, 20, 30, 40]), width: 2, height: 2 })),
  }
})

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))))
})

describe('一键载入临时演示照片', () => {
  it('两张带来源与模拟日期的照片只进入会话，重复点击不增加，也不写库', async () => {
    const media = useMediaStore()
    expect(await media.loadDemoPair('point-a')).toBe(2)
    const frames = media.framesOf('point-a')
    expect(frames).toHaveLength(2)
    expect(frames.every((row) => row.origin === 'demo_generated')).toBe(true)
    expect(frames.every((row) => row.label.includes('模拟日期'))).toBe(true)
    expect(await media.loadDemoPair('point-a')).toBe(0)
    expect(media.framesOf('point-a')).toHaveLength(2)
    expect(await db.attachments.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
  })

  it('第二张素材读取失败时两张都不加入，恢复后可重试', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(new Blob(['one'])))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetcher)
    const media = useMediaStore()
    expect(await media.loadDemoPair('point-a')).toBe(0)
    expect(media.framesOf('point-a')).toHaveLength(0)
    expect(media.tone).toBe('bad')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['ok']))))
    expect(await media.loadDemoPair('point-a')).toBe(2)
  })

  it('公开实拍按独立来源加入一次，不伪装成本校或生成的前后照片', async () => {
    const media = useMediaStore()
    expect(await media.loadPublicReference('point-a')).toBe(true)
    const [frame] = media.framesOf('point-a')
    expect(frame.origin).toBe('demo_public')
    expect(frame.label).toContain('非本校')
    expect(frame.label).toContain('载入时间')
    expect(await media.loadPublicReference('point-a')).toBe(false)
    expect(media.framesOf('point-a')).toHaveLength(1)
    expect(await db.attachments.count()).toBe(0)
  })

  it('跑完预设分析也不写库：事件、附件与操作日志一条不动', async () => {
    const media = useMediaStore()
    expect(await media.loadDemoPair('point-a')).toBe(2)
    const [before, after] = media.framesOf('point-a')
    const snapshot = async (): Promise<number[]> => [
      await db.events.count(),
      await db.attachments.count(),
      await db.audits.count(),
    ]
    const counts = await snapshot()

    const record = await media.runCompare({
      pointId: 'point-a',
      beforeId: before.id,
      afterId: after.id,
      region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    })

    expect(record).not.toBeNull()
    expect(await snapshot()).toEqual(counts)
  })
})

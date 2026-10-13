import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMediaStore } from '@/stores/media'

const region = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }

beforeEach(() => setActivePinia(createPinia()))

function addFrame(pointId: string): string {
  return useMediaStore().addUpload({
    pointId,
    capturedAt: '2026-09-29T09:00:00.000Z',
    label: '现场照片',
    fileName: 'scene.jpg',
    width: 640,
    height: 480,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
  }).id
}

describe('影像分析的测点归属守卫', () => {
  it('拒绝跨测点影像，即使调用方传了一个看似合法的测点 ID', async () => {
    const beforeId = addFrame('point-a')
    const afterId = addFrame('point-b')
    const media = useMediaStore()

    expect(await media.runCompare({ pointId: 'point-a', beforeId, afterId, region })).toBeNull()
    expect(media.compare).toBeNull()
    expect(media.message).toContain('同一测点')
  })

  it('拒绝把同一张影像作为前后两张', async () => {
    const id = addFrame('point-a')
    const media = useMediaStore()

    expect(await media.runCompare({ pointId: 'point-a', beforeId: id, afterId: id, region })).toBeNull()
    expect(media.compare).toBeNull()
  })

  it('公开实拍参考图不能与其他素材形成伪造的前后变化结论', async () => {
    const beforeId = addFrame('point-a')
    const media = useMediaStore()
    media.frames.push({
      id: 'public-reference',
      pointId: 'point-a',
      origin: 'demo_public',
      capturedAt: '2026-09-29T09:00:00.000Z',
      label: '公开参考图（非本校）',
      fileName: 'reference.jpg',
      size: 3,
      width: 640,
      height: 480,
      blob: new Blob([new Uint8Array([1, 2, 3])]),
      timeCode: null,
    })
    expect(await media.runCompare({ pointId: 'point-a', beforeId, afterId: 'public-reference', region })).toBeNull()
    expect(media.message).toContain('不能用于前后比对')
  })
})

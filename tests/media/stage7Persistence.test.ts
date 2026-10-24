/** 媒体审查：只替换解码和网络边界，执行真实 store。 */
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
const upload = vi.fn()
const register = vi.fn()
vi.mock('@/api/backend/runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/backend/runtime')>(), backendActive: () => true,
}))
vi.mock('@/api/backend/media', () => ({ uploadMedia: (...args: unknown[]) => upload(...args) }))
vi.mock('@/api/backend/assistant', () => ({
  registerSessionFrame: (...args: unknown[]) => register(...args),
}))
vi.mock('@/core/media/video', () => ({
  loadVideoMeta: vi.fn(async (_url: string, fileName: string) => ({
    video: {}, meta: { durationSeconds: 12, width: 960, height: 720, fileName },
  })),
  releaseVideo: vi.fn(),
  extractKeyframes: vi.fn(async () => [3, 6, 9].map((timeCode) => ({
    index: timeCode, timeCode, blob: new Blob(['frame']), width: 480, height: 360,
  }))),
}))
import { useMediaStore } from '@/stores/media'
import { useBackendSessionStore } from '@/stores/backend/session'
import { uploadSessionFrame } from '@/api/backend/mediaSession'
import type { MediaFrame } from '@/types/media'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  upload.mockReset().mockResolvedValue({ id: 'media-1' })
  register.mockReset().mockResolvedValue({ id: 'frame-1', contentUrl: '/content' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['video']))))
})
afterEach(() => vi.unstubAllGlobals())

function frame(): MediaFrame {
  return { id: 'f1', pointId: 'A', origin: 'demo_generated', capturedAt: 'now',
    label: '模拟', fileName: 'demo.png', size: 4, width: 10, height: 10,
    blob: new Blob(['test']), timeCode: null }
}

it('服务端模式抽帧后应进入正式上传登记链路', async () => {
  const media = useMediaStore()
  await media.loadBundledVideo('A', 'change', () => {})
  await media.captureKeyframes('A', '演示')
  await media.settleSync()
  expect(media.frames).toHaveLength(3)
  // 4 = 原视频字节 1 次 + 三个关键帧；审查桩未提供视频登记接口，因此帧登记仍断言 3 次。
  expect(upload).toHaveBeenCalledTimes(4)
  expect(register).toHaveBeenCalledTimes(3)
})

it('模拟来源需要传入正式上传接口，不能恢复为普通上传', async () => {
  await uploadSessionFrame(frame())
  expect(upload.mock.calls[0][0]).toMatchObject({ origin: 'demo_generated' })
})

it('切换身份后清除上一身份已经取回的媒体字节', async () => {
  const identity = useBackendSessionStore()
  identity.user = { id: 'old', name: '旧', role: 'safety', roleLabel: '安全', buildingIds: null }
  const media = useMediaStore()
  media.addUpload({ ...frame() })
  await media.settleSync()
  identity.user = { id: 'new', name: '新', role: 'inspector', roleLabel: '巡检', buildingIds: [] }
  await nextTick()
  expect(media.frames).toEqual([])
})

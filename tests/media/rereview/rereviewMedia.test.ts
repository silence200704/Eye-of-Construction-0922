/** 复审：执行真实媒体store，网络与解码边界受控。 */
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
const io = vi.hoisted(() => ({
  upload: vi.fn(), register: vi.fn(), video: vi.fn(), analysis: vi.fn(),
  summary: vi.fn(), blob: vi.fn(),
}))
vi.mock('@/api/backend/runtime', async (original) => ({
  ...await original<typeof import('@/api/backend/runtime')>(), backendActive: () => true,
}))
vi.mock('@/api/backend/media', () => ({ uploadMedia: (...a: unknown[]) => io.upload(...a) }))
vi.mock('@/api/backend/assistant', () => ({
  registerSessionFrame: (...a: unknown[]) => io.register(...a),
  saveSessionVideo: (...a: unknown[]) => io.video(...a),
  saveVideoAnalysis: (...a: unknown[]) => io.analysis(...a),
  fetchMediaSession: (...a: unknown[]) => io.summary(...a),
}))
vi.mock('@/api/backend/mediaSession', async (original) => ({
  ...await original<typeof import('@/api/backend/mediaSession')>(),
  frameBlob: (...a: unknown[]) => io.blob(...a),
}))
vi.mock('@/core/media/video', () => ({
  loadVideoMeta: vi.fn(async (_url, fileName) => ({
    video: {}, meta: { durationSeconds: 12, width: 960, height: 720, fileName },
  })), releaseVideo: vi.fn(),
  extractKeyframes: vi.fn(async () => [3, 6, 9].map((timeCode, index) => ({
    index, timeCode, blob: new Blob(['frame']), width: 480, height: 360,
  }))),
}))
vi.mock('@/core/media/analysis', () => ({
  analysePair: vi.fn(async () => [0.15, 0].map((changedRatio) => ({
    changedRatio, status: 'changed', summary: '区域统计',
  }))), compareRecordOf: vi.fn((input) => ({ ...input, ...input.result, comparedAt: 'now' })),
}))
import { useMediaStore } from '@/stores/media'
import { useBackendSessionStore } from '@/stores/backend/session'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  useBackendSessionStore().user = {
    id: 'demo-safety', name: '演示安全', role: 'safety', roleLabel: '安全', buildingIds: null,
  }
  for (const fn of Object.values(io)) fn.mockReset()
  let mediaNo = 0, frameNo = 0
  io.upload.mockImplementation(async () => ({ id: `media-${++mediaNo}` }))
  io.register.mockImplementation(async (input) => ({ ...input, id: `mf-${++frameNo}`, contentUrl: '/frame' }))
  io.video.mockImplementation(async (input) => ({ ...input, id: 'mv-server', contentUrl: '/video' }))
  io.analysis.mockResolvedValue({ id: 'mv-server' })
  io.blob.mockResolvedValue(new Blob(['bytes']))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['video']))))
})
afterEach(() => vi.unstubAllGlobals())

it('正常上传/抽帧/分析后，刷新能用服务端视频身份恢复分析', async () => {
  const media = useMediaStore()
  await media.loadBundledVideo('A', 'change', () => {})
  await media.captureKeyframes('A', '视频')
  await media.settleSync()
  await media.analyseVideo()
  const analysis = io.analysis.mock.calls[0][0].analysis
  const metadata = io.video.mock.calls[0][0].metadata
  const frames = media.frames.map((frame) => ({
    ...frame, id: frame.remoteFrameId, mediaId: frame.remoteMediaId, videoId: 'mv-server',
    contentUrl: '/frame', mimeType: 'image/png',
  }))
  io.summary.mockResolvedValue({ frames, comparisons: [], videos: [{
    id: 'mv-server', pointId: 'A', mediaId: 'media-1', contentUrl: '/video', metadata, analysis,
  }] })
  setActivePinia(createPinia())
  useBackendSessionStore().user = {
    id: 'demo-safety', name: '演示安全', role: 'safety', roleLabel: '安全', buildingIds: null,
  }
  const restored = useMediaStore()
  await restored.restoreRemote('A')
  expect({ submittedVideoId: analysis.videoId, restoredVideoId: restored.videoMeta?.id,
    restoredAnalysis: restored.videoAnalysis }).toMatchObject({
    submittedVideoId: 'mv-server', restoredVideoId: 'mv-server',
    restoredAnalysis: expect.objectContaining({ videoId: 'mv-server' }),
  })
})

it('下载视频字节期间换身份，不得回填上一身份视频/分析', async () => {
  let finish!: (blob: Blob) => void
  io.blob.mockReturnValue(new Promise<Blob>((resolve) => { finish = resolve }))
  io.summary.mockResolvedValue({ frames: [], comparisons: [], videos: [{
    id: 'mv-old', pointId: 'A', mediaId: 'm-old', contentUrl: '/video', metadata: {},
    analysis: { videoId: 'mv-old', pointId: 'A', frameIds: [], regions: {}, reason: '' },
  }] })
  const media = useMediaStore()
  const pending = media.restoreRemote('A')
  await vi.waitFor(() => expect(io.blob).toHaveBeenCalled())
  useBackendSessionStore().user = {
    id: 'new', name: '新', role: 'safety', roleLabel: '安全', buildingIds: [],
  }
  finish(new Blob(['old bytes']))
  await pending
  expect(media.videoMeta).toBeNull()
  expect(media.videoAnalysis).toBeNull()
})

it('同一身份范围收窄后清除原有媒体字节', async () => {
  const identity = useBackendSessionStore()
  identity.user = { id: 'same', name: '同一身份', role: 'safety', roleLabel: '安全', buildingIds: null }
  const media = useMediaStore()
  media.addUpload({ pointId: 'A', capturedAt: 'now', label: 'photo', fileName: 'a.png',
    width: 1, height: 1, blob: new Blob(['old bytes']) })
  await media.settleSync()
  identity.user = { ...identity.user, buildingIds: [] }
  expect(media.frames).toEqual([])
})

it('关键帧登记未完成时，分析必须等待并提交整张服务端引用', async () => {
  const pending: Array<() => void> = []
  let frameNo = 0
  io.register.mockImplementation((input: Record<string, unknown>) => new Promise((resolve) => {
    pending.push(() => resolve({ ...input, id: `mf-delayed-${++frameNo}`, contentUrl: '/frame' }))
  }))
  const media = useMediaStore()
  await media.loadBundledVideo('A', 'change', () => {})
  await media.captureKeyframes('A', '视频')
  const analysing = media.analyseVideo()
  let resolved = 0
  while (resolved < 3) {
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
    expect(io.analysis).not.toHaveBeenCalled()
    pending.shift()!()
    resolved += 1
  }
  await analysing
  const submitted = io.analysis.mock.calls[0][0].analysis
  expect(submitted.videoId).toBe('mv-server')
  expect(submitted.frameIds).toEqual(['mf-delayed-1', 'mf-delayed-2', 'mf-delayed-3'])
  expect(submitted.regions.crack.beforeId).toBe('mf-delayed-1')
  expect(submitted.regions.crack.afterId).toBe('mf-delayed-3')
})

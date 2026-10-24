import { ref, type Ref } from 'vue'
import { uid } from '@/core/id'
import { nowIso } from '@/core/time'
import { extractKeyframes, loadVideoMeta, releaseVideo } from '@/core/media/video'
import { analysePair, compareRecordOf } from '@/core/media/analysis'
import { DEMO_VIDEOS, VIDEO_REGIONS, type DemoVideoKey } from '@/config/media/demoVideos'
import type { MediaFrame } from '@/types/media'
import type { SessionVideo, VideoAnalysis } from '@/types/media/video'

type PersistedVideo = { mediaId: string; videoId: string; contentUrl: string }
type Context = {
  frames: Ref<MediaFrame[]>
  notify: (text: string, ok?: boolean) => void
  /** 服务端模式下把新帧送入正式上传登记链；本地演示模式是空操作。 */
  persistFrame?: (row: MediaFrame) => void
  /** 上传原视频并登记元数据；返回服务端身份，失败返回 null 且不冒称已保存。 */
  persistVideo?: (input: {
    file: File
    pointId: string
    metadata: SessionVideo
  }) => Promise<PersistedVideo | null>
  /** 保存视频分析结果；失败由调用方提示，不阻塞本地展示。 */
  persistVideoAnalysis?: (result: VideoAnalysis) => Promise<boolean>
}
type Guard = () => void

/** 视频、帧、分析共享视频身份；只有明确的任务才准备，所有提交前复核授权。 */
class VideoSession {
  videoUrl = ref('')
  videoMeta = ref<SessionVideo | null>(null)
  videoAnalysis = ref<VideoAnalysis | null>(null)
  constructor(private context: Context) {}

  clearVideo(): void {
    if (this.videoUrl.value) URL.revokeObjectURL(this.videoUrl.value)
    const id = this.videoMeta.value?.id
    this.context.frames.value = this.context.frames.value.filter((row) => row.videoId !== id || id === undefined)
    this.videoUrl.value = ''
    this.videoMeta.value = null
    this.videoAnalysis.value = null
  }

  async pickVideo(file: File, pointId = ''): Promise<SessionVideo | null> {
    try { return await this.commitVideo({ file, pointId, key: '', guard: () => {} }) }
    catch (cause) { this.context.notify(String(cause instanceof Error ? cause.message : cause), false); return null }
  }

  async commitVideo(input: { file: File; pointId: string; key: string; guard: Guard }): Promise<SessionVideo> {
    const url = URL.createObjectURL(input.file)
    try {
      const { video, meta } = await loadVideoMeta(url, input.file.name)
      releaseVideo(video)
      input.guard()
      const asset = DEMO_VIDEOS.find((row) => row.key === input.key)
      const next: SessionVideo = {
        ...meta, id: uid('video'), pointId: input.pointId, assetKey: input.key, assetVersion: 1, loadedAt: nowIso(),
        title: asset?.title ?? input.file.name, source: asset?.source ?? '本地用户文件',
        note: asset?.note ?? '机位与拍摄时间未核实，仅支持播放和抽帧，不作变化测量。', comparable: asset?.comparable ?? false,
      }
      this.clearVideo()
      this.videoUrl.value = url
      this.videoMeta.value = next
      const saved = await this.context.persistVideo?.({ file: input.file, pointId: input.pointId, metadata: next })
      if (saved && this.videoMeta.value?.id === next.id) {
        this.videoMeta.value = { ...next, remoteVideoId: saved.videoId, mediaId: saved.mediaId, contentUrl: saved.contentUrl }
      }
      return this.videoMeta.value
    } catch (cause) { URL.revokeObjectURL(url); throw cause }
  }

  async loadBundledVideo(pointId: string, key: DemoVideoKey, guard: Guard): Promise<SessionVideo> {
    guard()
    const current = this.videoMeta.value
    if (current?.pointId === pointId && current.assetKey === key && current.assetVersion === 1) return current
    const asset = DEMO_VIDEOS.find((row) => row.key === key)!
    const response = await fetch(`${import.meta.env.BASE_URL}${asset.path.slice(1)}`)
    if (!response.ok) throw new Error(`视频素材读取失败（HTTP ${response.status}）`)
    const file = new File([await response.blob()], asset.path.split('/').pop()!, { type: 'video/mp4' })
    return this.commitVideo({ file, pointId, key, guard })
  }

  async captureKeyframes(pointId: string, label: string, guard: Guard = () => {}): Promise<number> {
    const meta = this.videoMeta.value
    if (!meta || !pointId || (meta.pointId && meta.pointId !== pointId)) throw new Error('请先为同一测点选择视频，不能跨测点借用关键帧。')
    const existing = this.context.frames.value.filter((row) => row.videoId === meta.id)
    if (existing.length === 3) return 0
    const own = this.context.frames.value.filter((row) => row.pointId === pointId && row.videoId !== meta.id)
    if (own.length + 3 > 6) throw new Error('该测点最多保留 6 张会话影像；请先移除多余影像，视频不会覆盖现有照片。')
    const { video } = await loadVideoMeta(this.videoUrl.value, meta.fileName)
    try {
      const output = await extractKeyframes(video)
      guard()
      if (this.videoMeta.value?.id !== meta.id) throw new Error('视频已切换，本次抽帧结果未提交。')
      if (this.context.frames.value.filter((row) => row.pointId === pointId && row.videoId !== meta.id).length + 3 > 6) throw new Error('抽帧期间照片数量已变化，超过 6 张，未提交新帧。')
      const frames: MediaFrame[] = output.map((row) => ({
        id: uid('media'), pointId, videoId: meta.id, origin: 'video_frame', capturedAt: meta.loadedAt,
        label: `${label}｜${row.timeCode.toFixed(1)} 秒`, fileName: `${meta.fileName}#${row.index}`,
        size: row.blob.size, width: row.width, height: row.height, blob: row.blob, timeCode: row.timeCode,
      }))
      this.videoMeta.value = { ...meta, pointId }
      this.context.frames.value = [...this.context.frames.value.filter((row) => row.videoId !== meta.id), ...frames]
      for (const row of frames) this.context.persistFrame?.(row)
      this.videoAnalysis.value = null
      return frames.length
    } finally { releaseVideo(video) }
  }

  async analyseVideo(guard: Guard = () => {}): Promise<VideoAnalysis> {
    const meta = this.videoMeta.value
    if (!meta) throw new Error('当前会话没有视频。')
    const frames = this.context.frames.value.filter((row) => row.videoId === meta.id && row.pointId === meta.pointId).sort((a, b) => (a.timeCode ?? 0) - (b.timeCode ?? 0))
    if (frames.length !== 3) throw new Error('请先抽取该视频的三个关键帧。')
    const result: VideoAnalysis = { videoId: meta.id, pointId: meta.pointId, frameIds: frames.map((row) => row.id), regions: {}, reason: '' }
    if (!meta.comparable) result.reason = meta.note
    else {
      const keys = ['crack', 'control'] as const
      const regions = keys.map((key) => VIDEO_REGIONS[key])
      const results = await analysePair(frames[0].blob, frames[2].blob, regions)
      keys.forEach((key, index) => { result.regions[key] = compareRecordOf({ pointId: meta.pointId, beforeId: frames[0].id, afterId: frames[2].id, region: regions[index], result: results[index] }) })
    }
    guard()
    if (this.videoMeta.value?.id !== meta.id || !result.frameIds.every((id) => this.context.frames.value.some((row) => row.id === id))) throw new Error('视频或关键帧已失效，请重试。')
    this.videoAnalysis.value = result
    await this.context.persistVideoAnalysis?.(result)
    return result
  }

  /** 只读恢复：不重新上传、不重放抽帧或分析；视频身份直接采用服务端 ID。 */
  restoreVideo(file: File, meta: SessionVideo): void {
    const url = URL.createObjectURL(file)
    if (this.videoUrl.value) URL.revokeObjectURL(this.videoUrl.value)
    this.videoUrl.value = url
    this.videoMeta.value = meta
    this.videoAnalysis.value = null
  }

  restoreAnalysis(result: VideoAnalysis): void {
    if (this.videoMeta.value?.id !== result.videoId) return
    this.videoAnalysis.value = result
  }
}

export function createVideoSession(context: Context) {
  const session = new VideoSession(context)
  return {
    videoUrl: session.videoUrl, videoMeta: session.videoMeta, videoAnalysis: session.videoAnalysis,
    pickVideo: session.pickVideo.bind(session), clearVideo: session.clearVideo.bind(session),
    captureKeyframes: session.captureKeyframes.bind(session), loadBundledVideo: session.loadBundledVideo.bind(session),
    analyseVideo: session.analyseVideo.bind(session), restoreVideo: session.restoreVideo.bind(session),
    restoreAnalysis: session.restoreAnalysis.bind(session),
  }
}

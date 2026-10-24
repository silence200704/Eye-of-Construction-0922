/** 服务端影像会话的写入、恢复与迟到请求丢弃；store 只保留状态编排。 */
import { type Ref } from 'vue'
import { backendActive, currentEpoch } from '@/api/backend/runtime'
import { uploadMedia } from '@/api/backend/media'
import { frameBlob } from '@/api/backend/mediaSession'
import { restoreServerFrames } from '@/media/sessionRemote'
import { saveSessionVideo, saveVideoAnalysis, type RemoteComparison } from '@/api/backend/assistant'
import { saveComparisonRecord } from '@/media/sessionRemote'
import { useBackendSessionStore } from '@/stores/backend/session'
import type { MediaCompareRecord, MediaFrame } from '@/types/media'
import type { SessionVideo, VideoAnalysis } from '@/types/media/video'

export interface MediaServerContext {
  frames: Ref<MediaFrame[]>
  compare: Ref<MediaCompareRecord | null>
  remoteComparisons: Ref<RemoteComparison[]>
  notify: (text: string, ok?: boolean) => void
  settleSync: () => Promise<void>
  videoMeta: Ref<SessionVideo | null>
  restoreVideo: (file: File, metadata: SessionVideo) => void
  restoreAnalysis: (result: VideoAnalysis) => void
}

function sessionStillCurrent(actorId: string, epoch: number): boolean {
  return actorId === (useBackendSessionStore().user?.id ?? '') && epoch === currentEpoch()
}

function restoredVideo(video: {
  id: string
  pointId: string
  mediaId: string
  metadata: Record<string, unknown>
  contentUrl: string
}): SessionVideo {
  const meta = (video.metadata ?? {}) as Partial<SessionVideo>
  return {
    id: video.id,
    pointId: video.pointId,
    assetKey: meta.assetKey ?? '',
    assetVersion: meta.assetVersion ?? 1,
    fileName: meta.fileName ?? 'video.mp4',
    title: meta.title ?? '服务端视频',
    durationSeconds: meta.durationSeconds ?? 0,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    loadedAt: meta.loadedAt ?? '',
    source: meta.source ?? '服务端会话视频',
    note: meta.note ?? '从服务端受保护内容接口恢复；不重放抽帧或分析。',
    comparable: meta.comparable ?? false,
    remoteVideoId: video.id,
    mediaId: video.mediaId,
    contentUrl: video.contentUrl,
  }
}

function createMediaVideoWriter(context: MediaServerContext) {
  /** 上传视频原字节并登记元数据；失败只提示，不把本地播放当已保存。 */
  async function persistVideo(input: {
    file: File
    pointId: string
    metadata: SessionVideo
  }): Promise<{ mediaId: string; videoId: string; contentUrl: string } | null> {
    if (!backendActive()) return null
    const actorId = useBackendSessionStore().user?.id ?? ''
    const epoch = currentEpoch()
    try {
      const media = await uploadMedia({
        blob: input.file,
        fileName: input.metadata.fileName,
        draftId: input.metadata.id,
        pointId: input.pointId,
        capturedAt: input.metadata.loadedAt,
        origin: 'upload',
      })
      const saved = await saveSessionVideo({
        mediaId: media.id,
        pointId: input.pointId,
        metadata: { ...input.metadata },
      })
      if (!sessionStillCurrent(actorId, epoch)) return null
      return { mediaId: saved.mediaId, videoId: saved.id, contentUrl: saved.contentUrl }
    } catch (cause) {
      context.notify(
        `视频已在当前会话播放，但未写入服务端：${cause instanceof Error ? cause.message : String(cause)}`,
        false,
      )
      return null
    }
  }

  /** 保存视频分析结果；帧 ID 映射为服务端关键帧 ID。 */
  async function persistVideoAnalysis(result: VideoAnalysis): Promise<boolean> {
    if (!backendActive()) return false
    const video = context.videoMeta.value
    if (!video?.remoteVideoId) {
      context.notify('视频分析未写入服务端：视频尚未完成登记。', false)
      return false
    }
    const actorId = useBackendSessionStore().user?.id ?? ''
    const epoch = currentEpoch()
    try {
      const frameIds = result.frameIds.map(
        (id) => context.frames.value.find((row) => row.id === id)?.remoteFrameId ?? id,
      )
      await saveVideoAnalysis({ videoId: video.remoteVideoId, analysis: { ...result, frameIds } })
      return sessionStillCurrent(actorId, epoch)
    } catch (cause) {
      context.notify(
        `视频分析未写入服务端：${cause instanceof Error ? cause.message : String(cause)}`,
        false,
      )
      return false
    }
  }

  return { persistVideo, persistVideoAnalysis }
}

function createMediaComparisonWriter(context: MediaServerContext) {
  /** 把一次真实算出的比对结果写入服务端；关键帧未登记完成时明确失败。 */
  async function persistComparison(record: MediaCompareRecord): Promise<boolean> {
    const actorId = useBackendSessionStore().user?.id ?? ''
    const epoch = currentEpoch()
    await context.settleSync()
    const before = context.frames.value.find((row) => row.id === record.beforeId)
    const after = context.frames.value.find((row) => row.id === record.afterId)
    if (!before?.remoteFrameId || !after?.remoteFrameId) {
      context.notify('比对结果未写入服务端：关键帧尚未完成登记，请稍后重试。', false)
      return false
    }
    try {
      const saved = await saveComparisonRecord({
        record,
        beforeFrameId: before.remoteFrameId,
        afterFrameId: after.remoteFrameId,
      })
      if (!sessionStillCurrent(actorId, epoch)) return false
      context.remoteComparisons.value = [...context.remoteComparisons.value, saved]
      return true
    } catch (cause) {
      context.notify(
        `比对结果未写入服务端：${cause instanceof Error ? cause.message : String(cause)}`,
        false,
      )
      return false
    }
  }

  /**
   * 从服务端恢复关键帧、比对与视频；内容接口按身份鉴权，不保存 blob: URL。
   */
  async function restoreRemote(pointId: string): Promise<number> {
    if (pointId === '') return 0
    const actorId = useBackendSessionStore().user?.id ?? ''
    const epoch = currentEpoch()
    await context.settleSync()
    const restored = await restoreServerFrames({
      pointId,
      knownFrames: new Set(context.frames.value.map((row) => row.remoteFrameId ?? row.id)),
      knownMedia: new Set(
        context.frames.value.map((row) => row.remoteMediaId).filter((id): id is string => Boolean(id)),
      ),
    })
    if (!sessionStillCurrent(actorId, epoch)) return 0
    context.remoteComparisons.value = restored.comparisons
    if (restored.frames.length > 0) context.frames.value = [...context.frames.value, ...restored.frames]
    for (const video of restored.videos) {
      const blob = await frameBlob(video.contentUrl)
      const metadata = restoredVideo(video)
      context.restoreVideo(new File([blob], metadata.fileName, { type: 'video/mp4' }), metadata)
      if (video.analysis) context.restoreAnalysis(video.analysis as unknown as VideoAnalysis)
    }
    return restored.frames.length
  }

  return { persistComparison, restoreRemote }
}

export function createMediaServer(context: MediaServerContext) {
  const videoWriter = createMediaVideoWriter(context)
  const comparisonWriter = createMediaComparisonWriter(context)
  return {
    persistVideo: videoWriter.persistVideo,
    persistVideoAnalysis: videoWriter.persistVideoAnalysis,
    persistComparison: comparisonWriter.persistComparison,
    restoreRemote: comparisonWriter.restoreRemote,
  }
}

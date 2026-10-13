import type { MediaCompareRecord } from '../media'

/** 临时视频身份；不把 URL 写入回答或持久化。 */
export interface SessionVideo {
  id: string
  pointId: string
  assetKey: string
  assetVersion: number
  fileName: string
  title: string
  durationSeconds: number
  width: number
  height: number
  loadedAt: string
  source: string
  note: string
  comparable: boolean
}

export interface VideoAnalysis {
  videoId: string
  pointId: string
  frameIds: string[]
  regions: Record<string, MediaCompareRecord>
  reason: string
}

export interface AskVideoPreview {
  kind: 'video_evidence'
  video: SessionVideo
  analysis: VideoAnalysis | null
  frameIds: string[]
  seekTime?: number
  autoplay?: boolean
}

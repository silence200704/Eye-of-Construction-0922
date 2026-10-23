/** 影像会话的服务端持久化：原字节先上传，再登记关键帧；读取时重建临时内容 URL。 */
import { blobOf } from './runtime'
import { uploadMedia } from './media'
import {
  fetchMediaSession,
  registerSessionFrame,
  saveSessionComparison,
  type RemoteComparison,
  type RemoteMediaFrame,
  type RemoteMediaSession,
} from './assistant'
import type { FrameOrigin, MediaFrame } from '@/types/media'

export interface SessionFrameInfo {
  mediaId: string
  frameId: string
  contentUrl: string
}

export async function uploadSessionFrame(frame: MediaFrame): Promise<SessionFrameInfo> {
  const media = await uploadMedia({
    blob: frame.blob,
    fileName: frame.fileName,
    draftId: frame.id,
    pointId: frame.pointId,
    capturedAt: frame.capturedAt,
  })
  const registered = await registerSessionFrame({
    mediaId: media.id,
    pointId: frame.pointId,
    label: frame.label,
    capturedAt: frame.capturedAt,
    timeCode: frame.timeCode,
  })
  return { mediaId: media.id, frameId: registered.id, contentUrl: registered.contentUrl }
}

export function fetchRemoteSession(pointId: string): Promise<RemoteMediaSession> {
  return fetchMediaSession(pointId)
}

export function saveRemoteComparison(input: {
  pointId: string
  beforeId: string
  afterId: string
  result: Record<string, unknown>
}): Promise<RemoteComparison> {
  return saveSessionComparison(input)
}

/** 受保护内容接口按身份返回字节；不能把服务端路径直接当 img src。 */
export async function frameBlob(contentUrl: string): Promise<Blob> {
  return blobOf(contentUrl)
}

export function frameOfRemote(row: RemoteMediaFrame, blob: Blob): MediaFrame {
  return {
    id: row.id,
    pointId: row.pointId,
    origin: row.origin as FrameOrigin,
    capturedAt: row.capturedAt,
    label: row.label,
    fileName: row.fileName || `frame-${row.id}.png`,
    size: row.size,
    width: row.width,
    height: row.height,
    blob,
    timeCode: row.timeCode,
    remoteMediaId: row.mediaId,
    remoteFrameId: row.id,
    remoteContentUrl: row.contentUrl,
  }
}

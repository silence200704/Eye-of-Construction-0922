/** 影像会话的服务端恢复与比对保存；store 只负责状态提示。 */
import type { RemoteComparison } from '@/api/backend/assistant'
import {
  fetchRemoteSession,
  frameBlob,
  frameOfRemote,
  saveRemoteComparison,
} from '@/api/backend/mediaSession'
import type { MediaCompareRecord, MediaFrame } from '@/types/media'

export interface RestoredSession {
  frames: MediaFrame[]
  comparisons: RemoteComparison[]
}

/** 只补当前会话还没有的关键帧；内容接口按身份鉴权，取回字节重建预览。 */
export async function restoreServerFrames(input: {
  pointId: string
  knownFrames: Set<string>
  knownMedia: Set<string>
}): Promise<RestoredSession> {
  const summary = await fetchRemoteSession(input.pointId)
  const missing = summary.frames.filter(
    (row) => !input.knownFrames.has(row.id) && !input.knownMedia.has(row.mediaId),
  )
  const frames = await Promise.all(
    missing.map(async (row) => frameOfRemote(row, await frameBlob(row.contentUrl))),
  )
  return { frames, comparisons: summary.comparisons }
}

export function saveComparisonRecord(input: {
  record: MediaCompareRecord
  beforeFrameId: string
  afterFrameId: string
}): Promise<RemoteComparison> {
  return saveRemoteComparison({
    pointId: input.record.pointId,
    beforeId: input.beforeFrameId,
    afterId: input.afterFrameId,
    result: {
      changedRatio: input.record.changedRatio,
      maxRegionRatio: input.record.changedRatio,
      region: input.record.region,
      status: input.record.status,
      note: input.record.summary,
      computedAt: input.record.comparedAt,
      source: 'session',
    },
  })
}

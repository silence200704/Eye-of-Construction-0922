import { useMediaStore } from '@/stores/media'
import { evidencePreparedFor } from '@/stores/demo/evidence'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { useArchiveStore } from '@/stores/archive'
import { nowIso } from '@/core/time'
import type { PreparationObject, PreparationReceipt } from '@/core/demo/preparation/types'
import type { PointRef } from '../resolve'
import type { AskResult, AskStage } from '../types'
import { useDirectorStore } from '../director/state'
import { buildSnapshot } from '../selectors'
import { assembleAnswer } from '../ask'
import { draft } from '../answers/shared'
import { buildLink } from '../actions'
import { answerVideo } from './answer'
import { requestedVideoAsset } from './focus'

type Request = { question: string; onStage?: (stage: AskStage) => void }

function objects(pointId: string): PreparationObject[] {
  const media = useMediaStore()
  const video = media.videoMeta
  if (!video || video.pointId !== pointId) return []
  return [{ kind: 'video', id: video.id, label: video.title, source: video.source }, ...media.frames.filter((row) => row.videoId === video.id).map((row): PreparationObject => ({ kind: 'frame', id: row.id, label: row.label, source: video.source }))]
}

export async function runVideoTask(request: Request, point: PointRef): Promise<AskResult> {
  const session = usePreparationSession()
  const director = useDirectorStore()
  const token = session.id
  const receipt: PreparationReceipt = { requestId: crypto.randomUUID(), demoSessionId: token, datasetEpoch: session.epoch, capability: 'media', pointId: point.id, at: nowIso(), status: 'ready', created: [], reused: [], skipped: [], failed: [] }
  await useDemoScenarioStore().enqueuePreparation(async () => {
    const media = useMediaStore()
    const key = requestedVideoAsset(request.question, media.videoMeta, point.id)
    const currentId = media.videoMeta?.id
    const guard = (): void => {
      if (!session.permits('media', token) || director.cancelled) throw new Error('演示授权已撤销，停止读取视频。')
      if (useArchiveStore().pointById(point.id)?.status !== 'active' || (key === 'current' ? media.videoMeta?.id !== currentId || media.videoMeta?.pointId !== point.id : !evidencePreparedFor(point.id))) throw new Error('此测点没有可用的视频素材，请从系统设置唯一入口准备或上传同测点的视频，不能借用其它位置的视频。')
    }
    const before = new Set(objects(point.id).map((row) => row.id))
    const wasBusy = media.busy
    media.busy = true
    try {
      guard()
      request.onStage?.('records')
      director.progress = '正在读取本地视频'
      if (key !== 'current') await media.loadBundledVideo(point.id, key, guard)
      request.onStage?.('media')
      director.progress = '正在解码并抽取三个关键帧'
      await media.captureKeyframes(point.id, media.videoMeta!.title, guard)
      director.progress = '正在对比首末关键帧'
      await media.analyseVideo(guard)
      request.onStage?.('compare')
      guard()
    } catch (cause) {
      receipt.status = session.permits('media', token) && !director.cancelled ? 'failed' : 'cancelled'
      receipt.failed.push(cause instanceof Error ? cause.message : String(cause))
    } finally { media.busy = wasBusy }
    for (const row of objects(point.id)) (before.has(row.id) ? receipt.reused : receipt.created).push(row)
    session.record(receipt)
  })
  if (receipt.status !== 'ready') return assembleAnswer(request.question, 'video_compare', draft(receipt.failed.join('；'), { status: 'not_found', pointId: point.id, gaps: receipt.failed, links: [buildLink('settings')] }), buildSnapshot())
  director.progress = `视频证据已就绪；新增 ${receipt.created.length} 项，复用 ${receipt.reused.length} 项`
  request.onStage?.('compose')
  return assembleAnswer(request.question, 'video_compare', answerVideo(buildSnapshot(), point, request.question), buildSnapshot())
}

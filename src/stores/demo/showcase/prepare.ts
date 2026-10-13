import { db } from '@/db/database'
import { P_CRACK } from '@/db/seedFactories'
import { useArchiveStore } from '@/stores/archive'
import { useMediaStore } from '@/stores/media'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { prepareExtraArchive, CLOSED_CRACK, READY_CRACK } from '@/stores/writes/demo/coverage/archive'
import { prepareClosedHistory } from '@/stores/writes/demo/coverage/history'
import { preparePendingRed, prepareQualitySamples, addSample } from '@/stores/writes/demo/coverage/samples'
import { loadMediaEvidenceScenario } from '@/stores/writes/demo/mediaEvidence'
import { useRecordsStore } from '@/stores/records'
import { buildSnapshot } from '@/assistant/selectors'
import { completionGaps } from '@/assistant/cases/query'

/** 准备旁支与素材；主测点不调用会预先处置的旧全链加载器。 */
export async function prepareShowcase(): Promise<void> {
  const archive = useArchiveStore()
  if (!archive.pointById(P_CRACK) || !archive.ruleFor(P_CRACK,new Date().toISOString())) throw new Error('主案例缺少在册测点或适用规则')
  await prepareExtraArchive()
  await prepareQualitySamples()
  const historyId = await prepareClosedHistory({ resume: true })
  await preparePendingRed()
  await useRecordsStore().reload()
  const sampleTime = new Date(Date.now() - 30_000).toISOString()
  for (const [pointId,width] of [[READY_CRACK,0.82],[CLOSED_CRACK,0.53]] as const) {
    if (useRecordsStore().ofPoint(pointId).some(r => r.note.includes('自动演示24小时比较'))) continue
    await addSample({ pointId, values: { width }, unit: 'mm', sampleTime, tag: '自动演示24小时比较（模拟输入）' })
  }
  const result = await loadMediaEvidenceScenario({ pointId: P_CRACK })
  if (!result.ok) throw new Error(result.message)
  await useDemoScenarioStore().rememberPreparation('mediaEvidence',result.message,false,result.anchorRefs)
  const issue = await db.issues.where('eventId').equals(historyId).first()
  const snapshot = buildSnapshot()
  snapshot.details!.issues = await db.issues.toArray()
  snapshot.details!.orders = await db.workOrders.toArray()
  snapshot.events = await db.events.toArray()
  if (!issue || completionGaps(issue,snapshot).length) throw new Error('预检未找到完整办结历史案例')
  await prepareMedia()
}

/** 真正读取和解码随包素材；读不到不把“已登记”当作预检成功。 */
export async function prepareMedia(): Promise<void> {
  const media = useMediaStore()
  await media.loadEvidencePair(P_CRACK)
  if (media.framesOf(P_CRACK).filter(r => !r.videoId).length < 2) throw new Error(`照片预检失败：${media.message}`)
  await media.loadBundledVideo(P_CRACK,'change',() => {})
  await media.captureKeyframes(P_CRACK,'固定机位演示视频')
  if (!media.videoMeta || media.frames.filter(r => r.videoId === media.videoMeta!.id).length !== 3) throw new Error('视频解码抽帧预检失败')
}

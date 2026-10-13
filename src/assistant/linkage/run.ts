/**
 * 小瞳视觉证据的**编排**（唯一会读会话影像与演示素材登记的地方）。
 *
 * 顺序固定：
 * 1. 按测点取当前会话里的影像，选一对可比的；
 * 2. 一对都凑不出时，才去看设置页准备的视觉演示场景是否就绪，就绪就按需读取内置素材；
 * 3. 用**现有**像素差异算法对登记区域各算一遍（裂缝区 / 完好墙面 / 你自己框的那块）；
 * 4. 交给纯函数 `composeVisualEvidence` 组合成回答。
 *
 * 全程只读业务数据：不写库、不建示例校区、不改事件与问题状态；
 * 读取的内置素材只进当前会话（刷新即失），这也是为什么"再问一次"是安全的。
 */
import type { Region } from '@/core/media/compare'
import type { MediaCompareRecord, MediaFrameRef } from '@/types/media'
import { mediaPairIsAvailable, mediaPairPreview } from '../preview/mediaPair'
import type { PointRef } from '../resolve'
import { buildSnapshot, type AssistantSnapshot } from '../selectors'
import type { AnswerDraft } from '../answers/shared'
import type { AskMediaPairPreview, AskRegionKey, AskStage, AskVisualEvidencePreview } from '../types'
import { noFramesDraft, composeVisualEvidence } from './compose'

/** 三个区域各自的结果：没算过就是 null。 */
type RegionResults = AskVisualEvidencePreview['results']
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { evidencePreparedFor } from '@/stores/demo/evidence'
import { useMediaStore } from '@/stores/media'

export interface VisualEvidenceRequest {
  allowBuiltin?: boolean
  snapshot: AssistantSnapshot
  point: PointRef
  /** 定位口径（沿用上一轮明确选定的测点 / 问句点名） */
  matchNote: string
  /** 先看哪个区域；缺省按登记裂缝区 */
  active?: AskRegionKey
  /** 问法要求放大变化区域 */
  zoom?: boolean
  /** 照片卡上「自己框选」画出来的区域 */
  customRegion?: Region | null
  /** 阶段上报：每完成一步回调一次（读取记录 → 核对影像 → 计算差异 → 整理结果） */
  onStage?: (stage: AskStage) => void
  /** 旧回答重算时固定当次照片对，禁止重新挑选或补载素材。 */
  pair?: AskMediaPairPreview
}

/** 该测点当前会话里的影像。 */
function framesOfPoint(snapshot: AssistantSnapshot, pointId: string): MediaFrameRef[] {
  return snapshot.media.frames.filter((row) => row.pointId === pointId)
}

/** 影像页最近一次预设分析：只认属于这个测点的那次，别的测点的不借。 */
function compareOf(snapshot: AssistantSnapshot, pointId: string): MediaCompareRecord | null {
  const record = snapshot.media.compare
  return record !== null && record.pointId === pointId ? record : null
}

/**
 * 按需读取设置页准备的内置视觉演示素材。
 *
 * 只有设置页那条场景**确实就绪**时才读：没准备就说"去哪儿准备"，
 * 不在提问时悄悄造素材、更不写任何业务数据。
 */
async function ensureBuiltinEvidence(pointId: string): Promise<number> {
  const demo = useDemoScenarioStore()
  await demo.hydrate()
  if (!evidencePreparedFor(pointId)) return 0
  return useMediaStore().loadEvidencePair(pointId)
}

export async function answerVisualEvidence(req: VisualEvidenceRequest): Promise<AnswerDraft> {
  const active: AskRegionKey = req.active ?? 'crack'
  let snapshot = req.snapshot
  let frames = framesOfPoint(snapshot, req.point.id)
  if (req.pair !== undefined && (req.pair.pointId !== req.point.id || !mediaPairIsAvailable(req.pair, frames))) {
    throw new Error('这组会话影像已失效；请重新提问，旧回答不会补载或替换照片。')
  }
  let pair = req.pair ?? mediaPairPreview(frames, compareOf(snapshot, req.point.id))
  // 监测记录已经在快照里读好了：这一步真的做完才报
  req.onStage?.('records')

  if (req.allowBuiltin !== false && pair === null && frames.length === 0 && (await ensureBuiltinEvidence(req.point.id)) > 0) {
    // 会话影像变了，重新拍一份快照再选一次：不拿手里那份过期的帧列表硬凑
    snapshot = buildSnapshot()
    frames = framesOfPoint(snapshot, req.point.id)
    pair = mediaPairPreview(frames, compareOf(snapshot, req.point.id))
  }

  req.onStage?.('media')
  if (pair === null && frames.length === 0) {
    const demo = useDemoScenarioStore()
    return noFramesDraft({
      snapshot,
      point: req.point,
      matchNote: req.matchNote,
      scenarioReady: demo.stateOf('mediaEvidence').ready,
    })
  }

  const results = pair === null ? emptyResults() : await analyseRegions(req, pair)
  req.onStage?.('compare')
  req.onStage?.('compose')
  return composeVisualEvidence({
    snapshot,
    point: req.point,
    pair,
    single: pair === null ? frames[0] ?? null : null,
    results,
    active,
    matchNote: req.matchNote,
    zoom: req.zoom,
  })
}

function emptyResults(): RegionResults {
  return { crack: null, control: null, custom: null }
}

/** 各算一遍：裂缝区与完好墙面总是都算，这样对照不用再点一次；自框区域按需算。 */
async function analyseRegions(
  req: VisualEvidenceRequest,
  pair: { beforeId: string; afterId: string; regions: { crack: Region; control: Region } | null },
): Promise<RegionResults> {
  const jobs: { key: string; region: Region }[] = []
  if (pair.regions !== null) {
    jobs.push({ key: 'crack', region: pair.regions.crack }, { key: 'control', region: pair.regions.control })
  }
  if (req.customRegion !== undefined && req.customRegion !== null) jobs.push({ key: 'custom', region: req.customRegion })
  if (jobs.length === 0) return emptyResults()
  const computed = await useMediaStore().analyseRegions({
    pointId: req.point.id,
    beforeId: pair.beforeId,
    afterId: pair.afterId,
    regions: jobs,
  })
  if (computed === null) throw new Error(useMediaStore().message || '区域计算失败或会话影像已失效，请重试。')
  return { crack: computed.crack ?? null, control: computed.control ?? null, custom: computed.custom ?? null }
}

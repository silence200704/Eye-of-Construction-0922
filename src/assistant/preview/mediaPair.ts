/**
 * 回答内的照片对：挑出可比的两张，并带上它们的来源与**登记区域**。
 *
 * 挑选优先级固定（谁都不许偷换照片）：
 * 1. 影像页明确跑过的那一对（人都选过了，只要两张都还在会话里就照原样展示）；
 * 2. 用户自己加进来的两张（人工上传 / 视频关键帧），取时间上的早、晚各一张；
 * 3. 演示证据素材（公开实拍原图 + 同底图模拟变化）；
 * 4. 生成的演示前后照片。
 * 公开参考图（`demo_public`）**永远不参与比对**：它跟谁都不是同一机位。
 */
import { DEMO_COMPARE_REGIONS, DEMO_EVIDENCE_NOTE, DEMO_EVIDENCE_REGIONS } from '@/config/media/demoPhotos'
import type { MediaCompareRecord, MediaFrameRef, FrameOrigin } from '@/types/media'
import type { AskMediaPairPreview, MediaPairSource } from '../types'

/** 内置素材对的口径：两张图必须是同一组的，不跨素材借用说明。 */
interface BuiltinSpec {
  note: string
  regions: { crack: { x: number; y: number; w: number; h: number }; control: { x: number; y: number; w: number; h: number } }
}

const BUILTIN_SPECS: Partial<Record<FrameOrigin, BuiltinSpec>> = {
  demo_evidence: { note: DEMO_EVIDENCE_NOTE, regions: DEMO_EVIDENCE_REGIONS },
  demo_generated: {
    note: '生成的演示前后照片：拍摄日期是模拟值，只有登记裂缝区被改动过，不是现场连续拍摄。',
    regions: DEMO_COMPARE_REGIONS,
  },
}

/** 用户自己影像的说明：会话影像刷新即失，且角度与光照都会影响结果。 */
const SESSION_NOTE = '当前会话里的影像：刷新即失；拍摄角度、距离与光照都会影响像素差异结果。'

/** 取一组里的早、晚两张；不足两张返回 null。 */
function endsOf(rows: MediaFrameRef[]): [MediaFrameRef, MediaFrameRef] | null {
  if (rows.length < 2) return null
  const sorted = [...rows].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  return [sorted[0], sorted[sorted.length - 1]]
}

/** 按来源分组取对：用户影像优先，其次公开实拍派生对，最后生成演示照片。 */
function pickPair(eligible: MediaFrameRef[]): [MediaFrameRef, MediaFrameRef] | null {
  const groups: FrameOrigin[][] = [['upload', 'video_frame'], ['demo_evidence'], ['demo_generated']]
  for (const group of groups) {
    const pair = endsOf(eligible.filter((row) => group.includes(row.origin)))
    if (pair !== null) return pair
  }
  return null
}

/** 旧回答只认当次照片ID；缺图、跨测点或公开参考图都视为失效。 */
export function mediaPairIsAvailable(pair: AskMediaPairPreview, frames: MediaFrameRef[]): boolean {
  return pair.beforeId !== pair.afterId && [pair.beforeId, pair.afterId].every((id) =>
    frames.some((row) => row.id === id && row.pointId === pair.pointId && row.origin !== 'demo_public'),
  )
}

/** 单张内置素材的登记区域；人工上传的照片没有登记区域，返回 null。 */
export function regionsOf(frame: MediaFrameRef): BuiltinSpec['regions'] | null {
  return BUILTIN_SPECS[frame.origin]?.regions ?? null
}

/** 两张图的来源决定这份预览的口径：是不是内置演示素材、有没有登记区域。 */
function describe(pair: [MediaFrameRef, MediaFrameRef]): { source: MediaPairSource; note: string; regions: BuiltinSpec['regions'] | null } {
  const [before, after] = pair
  const spec = before.origin === after.origin ? BUILTIN_SPECS[before.origin] : undefined
  if (spec === undefined) return { source: 'session', note: SESSION_NOTE, regions: null }
  return { source: 'builtin', note: spec.note, regions: spec.regions }
}

/**
 * 选定一对可比影像。
 *
 * `compare` 是影像页最近一次预设分析：只要它选的两张都还在、且属于同一测点，
 * 就精确复现那一对；两张缺一张时返回 null —— 宁可说"这组已失效"，也不换成别的图。
 */
export function mediaPairPreview(frames: MediaFrameRef[], compare: MediaCompareRecord | null): AskMediaPairPreview | null {
  const eligible = frames.filter((row) => row.origin !== 'demo_public')
  if (compare !== null) {
    const picked = [compare.beforeId, compare.afterId]
      .map((id) => eligible.find((row) => row.id === id))
    if (picked[0] === undefined || picked[1] === undefined || picked[0].id === picked[1].id) return null
    const pair: [MediaFrameRef, MediaFrameRef] = [picked[0], picked[1]]
    return pairPreview(pair)
  }
  const pair = pickPair(eligible)
  return pair === null ? null : pairPreview(pair)
}

/** 一对确定的帧 → 回答里的照片对预览（来源与登记区域由两张图的 origin 决定）。 */
function pairPreview(pair: [MediaFrameRef, MediaFrameRef]): AskMediaPairPreview {
  const spec = describe(pair)
  return {
    kind: 'media_pair',
    pointId: pair[0].pointId,
    beforeId: pair[0].id,
    afterId: pair[1].id,
    source: spec.source,
    note: spec.note,
    regions: spec.regions,
  }
}

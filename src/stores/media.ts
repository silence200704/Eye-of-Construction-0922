/**
 * 影像会话（当前页面的临时影像，不进数据库）。
 *
 * 为什么不做成仓储表：方案要求"刷新后会话影像消失"，而且这一轮不做视频表、不做数据库迁移。
 * 放内存里天然满足"刷新即失"，也不会给备份、完整性检查、导出加新的字段。
 *
 * 这里**只存**，不写库：整份 store 没有一处仓储写入调用（有用例守着）。
 * 需要正式留存的照片，由用户拿到问题与工单页按现有附件入口入库。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { datasetResetVersion } from './demo/registry'
import { createVideoSession } from './media/videoSession'
import { uid } from '@/core/id'
import { nowIso } from '@/core/time'
import { type Region } from '@/core/media/compare'
import { analysePair, compareRecordOf } from '@/core/media/analysis'
import { decodeUpload } from '@/core/media/capture'
import { DEMO_EVIDENCE_NOTE, DEMO_EVIDENCE_PAIR, DEMO_PHOTOS, PUBLIC_CRACK_REFERENCE } from '@/config/media/demoPhotos'
import type { FrameOrigin, MediaCompareRecord, MediaFrame, MediaFrameRef } from '@/types/media'

/** 单个测点最多保留几张会话影像：再多就不好选了，也提示用户去留存 */
export const SESSION_FRAME_LIMIT = 6

async function readBundledPhoto(input: { path: string; fileName: string; mimeType: string }): Promise<Awaited<ReturnType<typeof decodeUpload>>> {
  const path = `${import.meta.env.BASE_URL}${input.path.slice(1)}`
  const response = await fetch(path)
  if (!response.ok) throw new Error(`演示照片 ${input.fileName} 读取失败（HTTP ${response.status}）`)
  const file = new File([await response.blob()], input.fileName, { type: input.mimeType })
  return decodeUpload(file)
}

function newFrame(input: {
  pointId: string
  origin: FrameOrigin
  capturedAt: string
  label: string
  fileName: string
  width: number
  height: number
  blob: Blob
  timeCode: number | null
}): MediaFrame {
  return {
    id: uid('media'),
    pointId: input.pointId,
    origin: input.origin,
    capturedAt: input.capturedAt,
    label: input.label,
    fileName: input.fileName,
    size: input.blob.size,
    width: input.width,
    height: input.height,
    blob: input.blob,
    timeCode: input.timeCode,
  }
}

export const useMediaStore = defineStore('media', () => {
  const frames = ref<MediaFrame[]>([])
  /** 最近一次预设分析的结果 */
  const compare = ref<MediaCompareRecord | null>(null)
  /** 正在跑的耗时动作（压缩、抽帧、比对） */
  const busy = ref(false)
  const message = ref('')
  const tone = ref<'ok' | 'bad'>('ok')
  function notify(text: string, ok = true): void {
    message.value = text
    tone.value = ok ? 'ok' : 'bad'
  }

  const framesOf = (pointId: string): MediaFrame[] =>
    frames.value.filter((row) => row.pointId === pointId).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))

  const refsOf = (pointId: string): MediaFrameRef[] =>
    framesOf(pointId).map((row) => ({
      id: row.id,
      pointId: row.pointId,
      origin: row.origin,
      capturedAt: row.capturedAt,
      label: row.label,
      timeCode: row.timeCode,
      videoId: row.videoId,
    }))

  function addFrame(row: MediaFrame): void {
    const existing = framesOf(row.pointId)
    frames.value = [...frames.value, row]
    if (existing.length + 1 > SESSION_FRAME_LIMIT) {
      notify(`该测点的会话影像已有 ${existing.length + 1} 张（上限 ${SESSION_FRAME_LIMIT} 张），建议先清理或去问题附件入口留存。`)
    }
  }

  /** 人工上传一张照片（已压缩）；拍摄时间由调用方给出，不给就按文件时间 */
  function addUpload(input: {
    pointId: string
    capturedAt: string
    label: string
    fileName: string
    width: number
    height: number
    blob: Blob
  }): MediaFrame {
    const row = newFrame({ ...input, origin: 'upload', timeCode: null })
    addFrame(row)
    return row
  }

  /** 一键载入同机位演示照片：素材随包提供，压缩后只放当前会话。 */
  async function loadDemoPair(pointId: string): Promise<number> {
    if (busy.value) return 0
    if (pointId === '') {
      notify('请先选择测点，再载入演示前后照片。', false)
      return 0
    }
    const missing = DEMO_PHOTOS.filter((item) => !framesOf(pointId).some(
      (frame) => frame.origin === 'demo_generated' && frame.fileName === item.fileName,
    ))
    if (missing.length === 0) {
      notify('这组演示前后照片已在当前测点会话中，无需重复加入。')
      return 0
    }
    if (framesOf(pointId).length + missing.length > SESSION_FRAME_LIMIT) {
      notify(`该测点最多保留 ${SESSION_FRAME_LIMIT} 张会话影像，请先移除多余影像再载入演示照片。`, false)
      return 0
    }
    busy.value = true
    try {
      const prepared = await Promise.all(missing.map(async (item) => ({ item, photo: await readBundledPhoto(item) })))
      for (const { item, photo } of prepared) {
        addFrame(newFrame({
          pointId,
          origin: 'demo_generated',
          capturedAt: new Date(item.capturedAt).toISOString(),
          label: item.label,
          fileName: item.fileName,
          width: photo.width,
          height: photo.height,
          blob: photo.blob,
          timeCode: null,
        }))
      }
      notify(`已加入 ${prepared.length} 张生成的演示前后照片（模拟日期，只在当前会话）。`)
      return prepared.length
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), false)
      return 0
    } finally {
      busy.value = false
    }
  }

  /** 一键加入公开实拍供展示；与生成的同机位前后组分开标记。 */
  async function loadPublicReference(pointId: string): Promise<boolean> {
    if (busy.value) return false
    if (pointId === '') {
      notify('请先选择测点，再加入公开参考图。', false)
      return false
    }
    if (framesOf(pointId).some((row) => row.origin === 'demo_public' && row.fileName === PUBLIC_CRACK_REFERENCE.fileName)) {
      notify('公开参考图已在当前测点会话中，无需重复加入。')
      return false
    }
    if (framesOf(pointId).length >= SESSION_FRAME_LIMIT) {
      notify(`该测点最多保留 ${SESSION_FRAME_LIMIT} 张会话影像，请先移除多余影像。`, false)
      return false
    }
    busy.value = true
    try {
      const photo = await readBundledPhoto(PUBLIC_CRACK_REFERENCE)
      addFrame(newFrame({
        pointId,
        origin: 'demo_public',
        capturedAt: nowIso(),
        label: PUBLIC_CRACK_REFERENCE.label,
        fileName: PUBLIC_CRACK_REFERENCE.fileName,
        width: photo.width,
        height: photo.height,
        blob: photo.blob,
        timeCode: null,
      }))
      notify('已加入 1 张 CC0 公开实拍参考图（非本校；所示时间为载入时间）。')
      return true
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), false)
      return false
    } finally {
      busy.value = false
    }
  }

  /**
   * 按需载入小瞳的**视觉证据素材**（公开实拍原图 + 同底图模拟变化）。
   *
   * 只在设置页一键载入过视觉演示场景、用户又确实问了这件事时才读取；
   * 素材随包提供，压缩后只放当前会话，任何时候都不写数据库。
   * 若会话里已经有同一张图的"公开参考图"副本，先把那份去掉再成对加入 ——
   * 否则同一张照片会以两个来源标签并排列着，看着像两张不同的图。
   */
  async function loadEvidencePair(pointId: string, options: { beforeCommit?: () => void } = {}): Promise<number> {
    if (busy.value) return 0
    if (pointId === '') {
      notify('请先选定测点，再读取视觉证据素材。', false)
      return 0
    }
    const own = framesOf(pointId)
    const missing = DEMO_EVIDENCE_PAIR.filter(
      (item) => !own.some((frame) => frame.origin === 'demo_evidence' && frame.fileName === item.fileName),
    )
    if (missing.length === 0) return 0
    // 同一张原图若已作为"公开参考图"载入，这里顶替它，不额外多留一份
    const replaced = own.filter(
      (frame) => frame.origin === 'demo_public' && DEMO_EVIDENCE_PAIR.some((item) => item.fileName === frame.fileName),
    )
    if (own.length - replaced.length + missing.length > SESSION_FRAME_LIMIT) {
      notify(`该测点最多保留 ${SESSION_FRAME_LIMIT} 张会话影像，请先移除多余影像再读取视觉证据素材。`, false)
      return 0
    }
    busy.value = true
    try {
      const prepared = await Promise.all(missing.map(async (item) => ({ item, photo: await readBundledPhoto(item) })))
      options.beforeCommit?.()
      if (replaced.length > 0) frames.value = frames.value.filter((row) => !replaced.includes(row))
      for (const { item, photo } of prepared) {
        addFrame(newFrame({
          pointId,
          origin: 'demo_evidence',
          capturedAt: new Date(item.capturedAt).toISOString(),
          label: item.label,
          fileName: item.fileName,
          width: photo.width,
          height: photo.height,
          blob: photo.blob,
          timeCode: null,
        }))
      }
      notify(`已读取视觉证据素材 ${prepared.length} 张（公开实拍原图 + 同底图模拟变化）。${DEMO_EVIDENCE_NOTE}`)
      return prepared.length
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), false)
      return 0
    } finally {
      busy.value = false
    }
  }

  /**
   * 小瞳视觉证据的**区域对比**：同一对影像、多个登记区域各算一遍。
   *
   * 与影像页的 `runCompare` 分开是有意的：这里**不覆盖**影像页的"最近一次预设分析"，
   * 免得小瞳的一次提问把用户在影像页亲手选的区域顶掉。
   * 计算与影像页共用 `analysePair`，口径完全一致；同样不写任何业务数据。
   */
  async function analyseRegions(input: {
    pointId: string
    beforeId: string
    afterId: string
    regions: { key: string; region: Region }[]
  }): Promise<Record<string, MediaCompareRecord> | null> {
    const before = frames.value.find((row) => row.id === input.beforeId)
    const after = frames.value.find((row) => row.id === input.afterId)
    if (before === undefined || after === undefined) return null
    if (before.id === after.id || before.pointId !== input.pointId || after.pointId !== input.pointId) return null
    if (before.origin === 'demo_public' || after.origin === 'demo_public') return null
    if (!videoPairAllowed(before, after)) return null
    busy.value = true
    try {
      const results = await analysePair(before.blob, after.blob, input.regions.map((row) => row.region))
      const out: Record<string, MediaCompareRecord> = {}
      input.regions.forEach((row, index) => {
        out[row.key] = compareRecordOf({
          pointId: input.pointId,
          beforeId: before.id,
          afterId: after.id,
          region: row.region,
          result: results[index],
        })
      })
      return out
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), false)
      return null
    } finally {
      busy.value = false
    }
  }

  const videoSession = createVideoSession({ frames, notify })
  watch(datasetResetVersion, () => videoSession.clearVideo(), { flush: 'sync' })

  function videoPairAllowed(before: MediaFrame, after: MediaFrame): boolean {
    if (!before.videoId && !after.videoId) return before.origin !== 'video_frame' && after.origin !== 'video_frame'
    const current = videoSession.videoMeta.value
    return current !== null && before.videoId === after.videoId && current.id === before.videoId && current.comparable
  }

  function removeFrame(id: string): void {
    frames.value = frames.value.filter((row) => row.id !== id)
    if (compare.value !== null && (compare.value.beforeId === id || compare.value.afterId === id)) compare.value = null
  }

  function clearPoint(pointId: string): void {
    if (videoSession.videoMeta.value?.pointId === pointId) videoSession.clearVideo()
    frames.value = frames.value.filter((row) => row.pointId !== pointId)
    if (compare.value !== null && compare.value.pointId === pointId) compare.value = null
  }

  /**
   * 运行预设分析：把两张图缩到同一长边取亮度，再按框选区域逐像素比。
   * 结论只有"疑似变化 / 未见明显差异 / 不可比对"，**不给毫米数**，也不写任何业务数据。
   */
  async function runCompare(input: { pointId: string; beforeId: string; afterId: string; region: Region }): Promise<MediaCompareRecord | null> {
    const before = frames.value.find((row) => row.id === input.beforeId)
    const after = frames.value.find((row) => row.id === input.afterId)
    if (before === undefined || after === undefined) {
      notify('请先选定两张要对比的影像。', false)
      return null
    }
    if (before.id === after.id || before.pointId !== input.pointId || after.pointId !== input.pointId) {
      notify('只能对比同一测点的两张不同影像，请重新选择。', false)
      return null
    }
    if (!videoPairAllowed(before, after)) {
      notify('视频机位未核实或不是同一视频，不能计算前后变化。', false)
      return null
    }
    if (before.origin === 'demo_public' || after.origin === 'demo_public') {
      notify('公开实拍参考图不是同机位照片，只供展示，不能用于前后比对。', false)
      return null
    }
    busy.value = true
    try {
      const [result] = await analysePair(before.blob, after.blob, [input.region])
      const record = compareRecordOf({ pointId: input.pointId, beforeId: before.id, afterId: after.id, region: input.region, result })
      compare.value = record
      notify(result.summary, result.status !== 'incomparable')
      return record
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), false)
      return null
    } finally {
      busy.value = false
    }
  }

  const frameCount = computed(() => frames.value.length)

  return {
    frames,
    compare,
    busy,
    message,
    tone,
    ...videoSession,
    frameCount,
    framesOf,
    refsOf,
    addUpload,
    loadDemoPair,
    loadPublicReference,
    loadEvidencePair,
    analyseRegions,
    removeFrame,
    clearPoint,
    runCompare,
    notify,
  }
})

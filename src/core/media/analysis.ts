/**
 * 影像比对的计算入口（纯计算，不含任何 store 状态）。
 *
 * 为什么单独放在 `core/media` 而不是留在 store 里：**计算口径必须只有一份**。
 * 影像页的「运行预设分析」与小瞳的区域对比都从这里出发 ——
 * 两边各写一遍"解码 + 逐像素比"，迟早出现同一对图给出两个结论。
 *
 * 只吃 Blob 与区域，不认测点、不认帧 ID：归属与绑定由调用方负责。
 */
import { nowIso } from '@/core/time'
import type { MediaCompareRecord } from '@/types/media'
import { compareFrames, type CompareResult, type Region } from './compare'
import { lumaOfBlob } from './capture'

/**
 * 一对影像 × 多个区域：**只解码一次**，按区域逐个跑现有像素差异分析。
 * 返回顺序与 `regions` 一一对应。
 */
export async function analysePair(before: Blob, after: Blob, regions: Region[]): Promise<CompareResult[]> {
  const [a, b] = await Promise.all([lumaOfBlob(before), lumaOfBlob(after)])
  return regions.map((region) =>
    compareFrames({ before: a.data, after: a.width === b.width && a.height === b.height ? b.data : [], width: a.width, height: a.height, region, includeMask: true }),
  )
}

export interface CompareRecordInput {
  pointId: string
  beforeId: string
  afterId: string
  region: Region
  result: CompareResult
  /** 比对时刻；不传就取当前时间 */
  at?: string
}

/** 比对结论 → 会话记录：字段固定，界面与回答都按这一份读。 */
export function compareRecordOf(input: CompareRecordInput): MediaCompareRecord {
  return {
    pointId: input.pointId,
    beforeId: input.beforeId,
    afterId: input.afterId,
    region: input.region,
    status: input.result.status,
    summary: input.result.summary,
    changedRatio: input.result.changedRatio,
    ...(input.result.mask ? { mask: input.result.mask } : {}),
    comparedAt: input.at ?? nowIso(),
  }
}

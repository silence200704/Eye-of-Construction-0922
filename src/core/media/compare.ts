/**
 * 影像比对的**预设分析**（纯函数）。
 *
 * 这个模块只做一件事：把"两次拍摄的同一区域"逐像素比一遍，给出可解释的差异统计。
 * 它**不是**裂缝识别，也**不给毫米数** —— 没有标定的照片里，像素差换算不出物理宽度，
 * 编一个数字出来就是在骗人。所以结论只有三种：疑似变化 / 未见明显差异 / 不可比对。
 *
 * 阈值是演示口径，写在界面上一并显示，方便评审照着核对。
 */

/** 归一化框选区域：取值 0~1，原点为图片左上角 */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export function sameRegion(a: Region, b: Region): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

export interface CompareOptions {
  /** 像素亮度差超过它才算"这一像素有变化"（0~255） */
  pixelDelta: number
  /** 有变化像素占比超过它才说"疑似变化" */
  changedRatio: number
  /** 两者整体平均亮度差超过它：光照条件明显不同，结论只能是"不可比对" */
  exposureTolerance: number
  /** 框选区域至少要有这么多像素，太小说明没认真框 */
  minPixels: number
}

/** 演示口径：界面会把这几个数一并展示，评审可据此核对 */
export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
  pixelDelta: 18,
  changedRatio: 0.08,
  exposureTolerance: 26,
  minPixels: 400,
}

export type CompareStatus = 'changed' | 'stable' | 'incomparable'

export interface PixelMask {
  width: number
  height: number
  /** 1 表示同一次比对中达到亮度差阈值；区域外为 0。 */
  data: Uint8Array
}

export interface CompareResult {
  mask?: PixelMask
  status: CompareStatus
  /** 框选区域内"有变化"的像素占比（0~1） */
  changedRatio: number
  /** 框选区域的平均亮度差（有符号：正=后一张更亮） */
  meanDelta: number
  summary: string
  /** 为什么只能给到这个结论；界面必须原样展示 */
  reasons: string[]
  /** 实际参与比对的像素数 */
  sampled: number
}

/** 结论边界：每次都随结果一起给，避免有人只看一句"疑似变化" */
export const COMPARE_BOUNDARIES: string[] = [
  '结论来自像素级亮度差异统计，属于**预设分析**，不是裂缝识别。',
  '没有标定，因此**不给宽度（毫米）等物理量**；需要数值请走监测记录与预警判定。',
  '影像差异**不会自动生成正式结构预警**，是否处置由人工判断。',
  '两图必须拍的是同一测点、同一区域；换角度、换光照都会影响结果。',
]

/** 把任意输入夹到合法区域；宽高为 0 或越界时收成 0，由调用方判"不可比对"。 */
export function clampRegion(region: Region): Region {
  const x = Math.min(Math.max(region.x, 0), 1)
  const y = Math.min(Math.max(region.y, 0), 1)
  return {
    x,
    y,
    w: Math.min(Math.max(region.w, 0), 1 - x),
    h: Math.min(Math.max(region.h, 0), 1 - y),
  }
}

/** 区域是否为"有效框选"：太窄或全是 0 都不算。 */
export function isUsableRegion(region: Region): boolean {
  const clamped = clampRegion(region)
  return clamped.w > 0.01 && clamped.h > 0.01
}

export interface RegionBox {
  left: number
  top: number
  width: number
  height: number
}

/** 归一化区域 → 像素框（用于取样与画遮罩） */
export function regionBox(region: Region, width: number, height: number): RegionBox {
  const clamped = clampRegion(region)
  const left = Math.round(clamped.x * width)
  const top = Math.round(clamped.y * height)
  const right = Math.round((clamped.x + clamped.w) * width)
  const bottom = Math.round((clamped.y + clamped.h) * height)
  return {
    left,
    top,
    width: Math.max(0, Math.min(width, right) - left),
    height: Math.max(0, Math.min(height, bottom) - top),
  }
}

/** 归一化区域内的像素索引（逐行扫描，不做插值） */
export function regionIndexes(box: RegionBox, width: number): number[] {
  const out: number[] = []
  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) out.push(y * width + x)
  }
  return out
}

export interface CompareInput {
  includeMask?: boolean
  /** 前一张的亮度序列（0~255，长度 = width × height） */
  before: ArrayLike<number>
  /** 后一张的亮度序列 */
  after: ArrayLike<number>
  width: number
  height: number
  region: Region
  options?: Partial<CompareOptions>
}

/**
 * 比对主入口。
 *
 * 顺序固定：先判能不能比（尺寸 / 框选 / 光照），再算差异，最后按阈值给结论。
 * 任何一种"不能比"都**不猜**，直接说明缺什么。
 */
export function compareFrames(input: CompareInput): CompareResult {
  const options = { ...DEFAULT_COMPARE_OPTIONS, ...(input.options ?? {}) }
  const expected = input.width * input.height

  if (input.width <= 0 || input.height <= 0 || input.before.length !== expected || input.after.length !== expected) {
    return incomparable('两张影像的尺寸不一致，无法逐像素比对。请用同一测点、同一取景范围的两张照片。')
  }
  if (!isUsableRegion(input.region)) {
    return incomparable('还没有框选对比区域。请在两图上框出同一处位置再运行预设分析。')
  }

  const box = regionBox(input.region, input.width, input.height)
  const indexes = regionIndexes(box, input.width)
  if (indexes.length < options.minPixels) {
    return incomparable(`框选区域太小（约 ${indexes.length} 像素，至少需要 ${options.minPixels} 像素），请放大后再框。`)
  }

  const mask = input.includeMask ? { width: input.width, height: input.height, data: new Uint8Array(expected) } : undefined
  let changed = 0
  let sum = 0
  for (const index of indexes) {
    const delta = input.after[index] - input.before[index]
    sum += delta
    if (Math.abs(delta) >= options.pixelDelta) {
      changed += 1
      if (mask) mask.data[index] = 1
    }
  }
  const changedRatio = changed / indexes.length
  const meanDelta = sum / indexes.length

  if (Math.abs(meanDelta) > options.exposureTolerance) {
    const result = incomparable(
      `两次拍摄的整体亮度差 ${meanDelta.toFixed(1)}（超过容差 ${options.exposureTolerance}），光照或曝光条件明显不同，这组照片**不可比对**。`,
    )
    return { ...result, changedRatio, meanDelta, sampled: indexes.length }
  }
  if (changedRatio > options.changedRatio) {
    return {
      ...(mask ? { mask } : {}),
      status: 'changed',
      changedRatio,
      meanDelta,
      summary: `框选区域内有 ${(changedRatio * 100).toFixed(1)}% 的像素出现明显差异（阈值 ${(options.changedRatio * 100).toFixed(0)}%），属于**疑似变化**，需要人工复核。`,
      reasons: [...boundaryNotes(), `参与比对像素 ${indexes.length}，像素差阈值 ${options.pixelDelta}。`],
      sampled: indexes.length,
    }
  }
  return {
    ...(mask ? { mask } : {}),
    status: 'stable',
    changedRatio,
    meanDelta,
    summary: `框选区域内未见明显差异（差异像素 ${(changedRatio * 100).toFixed(1)}%，未达阈值 ${(options.changedRatio * 100).toFixed(0)}%）。`,
    reasons: [...boundaryNotes(), `参与比对像素 ${indexes.length}，像素差阈值 ${options.pixelDelta}。`],
    sampled: indexes.length,
  }
}

function boundaryNotes(): string[] {
  return COMPARE_BOUNDARIES.slice(0, 3)
}

function incomparable(summary: string): CompareResult {
  // "不可比对"同样要把三条边界带上：越是没给结论，越要说清为什么给不了
  return { status: 'incomparable', changedRatio: 0, meanDelta: 0, summary, reasons: boundaryNotes(), sampled: 0 }
}

/** 状态中文名：界面与问答共用一处口径。 */
export function compareStatusLabel(status: CompareStatus): string {
  if (status === 'changed') return '疑似变化'
  if (status === 'stable') return '未见明显差异'
  return '不可比对'
}

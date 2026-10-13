/**
 * 影像的浏览器侧采集（DOM 相关，纯计算在 compare.ts）。
 *
 * 四件事：
 * 1. 把一张图压到统一的长边，取出**亮度序列**供比对数像素；
 * 2. 从本地视频里按时间码抽少量关键帧（演示用，不引入任何外部服务）；
 * 3. 统一的刻度口径：无论原图多大，都先缩到同一长边再取亮度，
 *    否则两张不同分辨率的照片连"像素对像素"都做不到。
 *
 * 不做的事：不判断内容、不识别裂缝、不产生物理量。
 */
import { compressPhoto } from '@/db/inspection/attachments'
import { sniffImageKind } from '@/core/image'

/** 比对前的统一长边：越大越准、越慢；这个值足够看清区域差异，也不会卡住界面 */
export const LUMA_MAX_EDGE = 480

export interface LumaFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 取亮度：0.299R + 0.587G + 0.114B（与常见灰度公式一致，便于人工复核） */
function luminance(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length / 4)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return out
}

async function drawToLuma(source: CanvasImageSource, width: number, height: number): Promise<LumaFrame> {
  const scale = Math.min(1, LUMA_MAX_EDGE / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('本机浏览器不支持画布，无法做影像比对')
  ctx.drawImage(source, 0, 0, w, h)
  return { data: luminance(ctx.getImageData(0, 0, w, h).data), width: w, height: h }
}

/** 压缩后的照片 → 亮度序列 */
export async function lumaOfBlob(blob: Blob): Promise<LumaFrame> {
  const bitmap = await createImageBitmap(blob)
  try {
    return await drawToLuma(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

export interface DecodedPhoto {
  blob: Blob
  width: number
  height: number
  size: number
}

/**
 * 上传照片：先按魔数判格式（改了扩展名的文件要能说清楚），再走与问题附件同一套压缩。
 * 压缩口径一致，是为了"从影像页转到问题附件留存"时不会出现两种画质。
 */
export async function decodeUpload(file: File): Promise<DecodedPhoto> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (sniffImageKind(head) === '') {
    throw new Error(`${file.name} 不是有效的 JPG / PNG（可能只是改了扩展名）`)
  }
  const photo = await compressPhoto(file)
  return { blob: photo.blob, width: photo.width, height: photo.height, size: photo.blob.size }
}

export { loadVideoMeta, extractKeyframes } from './video'
export type { VideoMeta, VideoKeyframe } from './video'

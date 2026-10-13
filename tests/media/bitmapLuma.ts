/**
 * 素材级测试共用的亮度采样。
 *
 * 与 `core/media/capture.ts` 同一口径（长边 `MAX_EDGE`、0.299/0.587/0.114 亮度、盒式缩放），
 * 放一处是因为"素材能不能过阈值"的结论必须与页面里跑出来的完全一致 ——
 * 各写一份缩放系数，迟早出现"测试说变化、演示说不变化"。
 */

/** 与 `core/media/capture.ts` 的 LUMA_MAX_EDGE 保持一致 */
export const MAX_EDGE = 480

export interface Bitmap {
  width: number
  height: number
  channels: number
  data: Uint8Array
}

export interface LumaFrame {
  data: Float32Array
  width: number
  height: number
}

/** 缩到统一长边后取亮度：盒式平均，近似 canvas 的平滑缩放。 */
export function lumaFrames(bitmap: Bitmap): LumaFrame {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const full = new Float32Array(bitmap.width * bitmap.height)
  for (let i = 0, j = 0; j < full.length; i += bitmap.channels, j += 1) {
    full[j] = 0.299 * bitmap.data[i] + 0.587 * bitmap.data[i + 1] + 0.114 * bitmap.data[i + 2]
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor((y * bitmap.height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * bitmap.height) / h))
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor((x * bitmap.width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * bitmap.width) / w))
      let sum = 0
      let n = 0
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          sum += full[yy * bitmap.width + xx]
          n += 1
        }
      }
      out[y * w + x] = sum / n
    }
  }
  return { data: out, width: w, height: h }
}

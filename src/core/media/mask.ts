import type { PixelMask } from './compare'

/** 只把已有二值掩膜着色；不重新计算阈值或推断裂缝。 */
export function maskRgba(mask: PixelMask): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(mask.width * mask.height * 4)
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i] !== 1) continue
    rgba.set([255, 109, 34, 220], i * 4)
  }
  return rgba
}

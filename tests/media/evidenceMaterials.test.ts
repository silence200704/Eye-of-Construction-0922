/**
 * 视觉证据素材的**素材级契约**（公开实拍原图 + 同底图模拟变化）。
 *
 * 直接读 `public/demo-media/` 里的两张真实 JPEG，按 `core/media/capture.ts` 的同一口径取亮度，
 * 再交给**真正的** `compareFrames` 判定。三条必须成立的事实：
 * 1. 登记裂缝区确实能被现有阈值判成「疑似变化」（不是"看起来有点不一样"）；
 * 2. 完好墙面判成「未见明显差异」（没改的地方不会被说成变了）；
 * 3. **改动只发生在登记区域内**：区域外的像素不许有任何达到阈值的差异。
 *
 * 第 3 条是这份素材能被称作"演示证据"的前提 —— 只靠肉眼比对两张图是查不出这一点的。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { compareFrames, DEFAULT_COMPARE_OPTIONS } from '@/core/media/compare'
import { DEMO_EVIDENCE_NOTE, DEMO_EVIDENCE_REGIONS } from '@/config/media/demoPhotos'
import { lumaFrames, type Bitmap } from './bitmapLuma'

const mediaDir = fileURLToPath(new URL('../../public/demo-media/', import.meta.url))

/** jpeg-js 解出来就是 RGBA，正好是 `lumaFrames` 要的通道顺序。 */
function loadJpeg(name: string): Bitmap {
  const decoded = jpeg.decode(readFileSync(`${mediaDir}${name}`), { useTArray: true })
  return { width: decoded.width, height: decoded.height, channels: 4, data: decoded.data }
}

const before = lumaFrames(loadJpeg('commons-crack-example.jpg'))
const after = lumaFrames(loadJpeg('commons-crack-evidence-simulated.jpg'))

function judge(region: { x: number; y: number; w: number; h: number }) {
  return compareFrames({ before: before.data, after: after.data, width: before.width, height: before.height, region })
}

/** 区域 → 像素范围（与 `core/media/compare.ts` 的取整口径一致）。 */
function pixelBox(region: { x: number; y: number; w: number; h: number }) {
  const x0 = Math.round(region.x * before.width)
  const y0 = Math.round(region.y * before.height)
  return {
    x0,
    y0,
    x1: Math.round((region.x + region.w) * before.width),
    y1: Math.round((region.y + region.h) * before.height),
  }
}

describe('视觉证据素材（真实像素）', () => {
  it('两张同底图、同尺寸，能逐像素比对', () => {
    expect(before.width).toBe(after.width)
    expect(before.height).toBe(after.height)
    expect(before.data.length).toBe(after.data.length)
  })

  it('登记裂缝区得到「疑似变化」，且高出阈值有安全余量', () => {
    const result = judge(DEMO_EVIDENCE_REGIONS.crack)
    expect(result.status).toBe('changed')
    expect(result.changedRatio).toBeGreaterThan(DEFAULT_COMPARE_OPTIONS.changedRatio * 1.5)
    // 差异比例必须由像素算出：0 就说明这张图根本没改，硬编码一个数也过不了这一条
    expect(result.changedRatio).toBeGreaterThan(0)
  })

  it('完好墙面得到「未见明显差异」', () => {
    const result = judge(DEMO_EVIDENCE_REGIONS.control)
    expect(result.status).toBe('stable')
    expect(result.changedRatio).toBeLessThan(DEFAULT_COMPARE_OPTIONS.changedRatio)
  })

  it('改动只在登记裂缝区内可见：区域外没有达到阈值的像素差', () => {
    const { x0, y0, x1, y1 } = pixelBox(DEMO_EVIDENCE_REGIONS.crack)
    let outsideChanged = 0
    let maxOutside = 0
    for (let y = 0; y < before.height; y += 1) {
      for (let x = 0; x < before.width; x += 1) {
        if (x >= x0 && x < x1 && y >= y0 && y < y1) continue
        const delta = Math.abs(after.data[y * before.width + x] - before.data[y * before.width + x])
        if (delta > maxOutside) maxOutside = delta
        if (delta >= DEFAULT_COMPARE_OPTIONS.pixelDelta) outsideChanged += 1
      }
    }
    // 区域外**没有任何一个**像素达到"算变化"的门槛：区域外的差异只剩 JPEG 重编码的量化噪声（实测最大不到 3 个亮度级）
    expect(outsideChanged).toBe(0)
    expect(maxOutside).toBeLessThan(5)
  })

  it('整图直比判不出变化：必须真的框到登记的裂缝区（守住"框选"这个动作的意义）', () => {
    expect(judge({ x: 0, y: 0, w: 1, h: 1 }).status).toBe('stable')
  })

  it('公共说明写清是"基于实拍素材的变化演示"，不冒充真实连续拍摄', () => {
    expect(DEMO_EVIDENCE_NOTE).toContain('基于实拍素材的变化演示')
    expect(DEMO_EVIDENCE_NOTE).toContain('非真实连续拍摄')
  })
})

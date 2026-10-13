/**
 * 影像预设分析（纯函数）。
 *
 * 这一组守的是"不许越界"：
 * 结论只有三态、区域必须先框、尺寸不一致或光照差太多就判不可比对、
 * **任何情况下都不产出毫米数**，也不出现"AI 识别/裂缝宽度"这类越界的说法。
 */
import { describe, expect, it } from 'vitest'
import {
  COMPARE_BOUNDARIES,
  DEFAULT_COMPARE_OPTIONS,
  clampRegion,
  compareFrames,
  compareStatusLabel,
  isUsableRegion,
  regionBox,
  regionIndexes,
  sameRegion,
} from '@/core/media/compare'

/** 造一张纯色/带斑块的亮度图：w×h 个 0~255 的整数 */
function luma(width: number, height: number, value: number | ((x: number, y: number) => number)): number[] {
  const out: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out.push(typeof value === 'function' ? value(x, y) : value)
  }
  return out
}

const REGION = { x: 0, y: 0, w: 1, h: 1 }

describe('框选区域', () => {
  it('越界的区域会被夹回图内', () => {
    expect(clampRegion({ x: -0.2, y: 0.5, w: 0.9, h: 0.9 })).toEqual({ x: 0, y: 0.5, w: 0.9, h: 0.5 })
  })

  it('太小的框选不算有效区域', () => {
    expect(isUsableRegion({ x: 0.5, y: 0.5, w: 0.001, h: 0.5 })).toBe(false)
    expect(isUsableRegion({ x: 0, y: 0, w: 0, h: 0 })).toBe(false)
    expect(isUsableRegion({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 })).toBe(true)
  })

  it('归一化区域换算成像素框，且不越界', () => {
    expect(regionBox({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 100, 80)).toEqual({ left: 50, top: 40, width: 50, height: 40 })
    expect(regionBox({ x: 0.9, y: 0.9, w: 0.9, h: 0.9 }, 100, 100)).toEqual({ left: 90, top: 90, width: 10, height: 10 })
  })

  it('像素索引数量等于框选面积', () => {
    expect(regionIndexes({ left: 2, top: 3, width: 4, height: 5 }, 20)).toHaveLength(20)
  })

  it('换框选范围后旧结果不再算当前结果', () => {
    expect(sameRegion(REGION, { ...REGION })).toBe(true)
    expect(sameRegion(REGION, { ...REGION, x: 0.1 })).toBe(false)
  })
})

describe('比对结论', () => {
  it('尺寸不一致 → 不可比对，而不是硬比', () => {
    const result = compareFrames({ before: luma(10, 10, 100), after: luma(12, 10, 100), width: 10, height: 10, region: REGION })
    expect(result.status).toBe('incomparable')
    expect(result.summary).toContain('尺寸不一致')
    expect(compareStatusLabel(result.status)).toBe('不可比对')
  })

  it('没有框选区域 → 不可比对，并说明要框选', () => {
    const result = compareFrames({ before: luma(40, 40, 100), after: luma(40, 40, 100), width: 40, height: 40, region: { x: 0, y: 0, w: 0, h: 0 } })
    expect(result.status).toBe('incomparable')
    expect(result.summary).toContain('框选')
  })

  it('两图完全一致 → 未见明显差异', () => {
    const result = compareFrames({ before: luma(40, 40, 120), after: luma(40, 40, 120), width: 40, height: 40, region: REGION })
    expect(result.status).toBe('stable')
    expect(result.changedRatio).toBe(0)
    expect(result.summary).toContain('未见明显差异')
  })

  it('区域内有明显变化 → 疑似变化，且给出差异占比', () => {
    // 左半边亮 40，右半边差 40（超过像素差阈值）→ 区域取全图时应判疑似变化
    const before = luma(40, 40, (x) => (x < 20 ? 100 : 140))
    const after = luma(40, 40, (x) => (x < 20 ? 100 : 180))
    const result = compareFrames({ before, after, width: 40, height: 40, region: REGION })
    expect(result.status).toBe('changed')
    expect(result.changedRatio).toBeGreaterThan(0.4)
    expect(result.summary).toContain('疑似变化')
  })

  it('只比框选区域：框在没变的一半上就不会报变化', () => {
    const before = luma(40, 40, (x) => (x < 20 ? 100 : 140))
    const after = luma(40, 40, (x) => (x < 20 ? 100 : 180))
    const leftHalf = { x: 0, y: 0, w: 0.4, h: 1 }
    const result = compareFrames({ before, after, width: 40, height: 40, region: leftHalf })
    expect(result.status).toBe('stable')
    expect(result.changedRatio).toBe(0)
  })

  it('整体亮度差过大 → 判不可比对（避免把"换了个光照"说成变化）', () => {
    const before = luma(40, 40, 60)
    const after = luma(40, 40, 160)
    const result = compareFrames({ before, after, width: 40, height: 40, region: REGION })
    expect(result.status).toBe('incomparable')
    expect(result.summary).toContain('亮度')
    // 仍然把统计值给出来，便于人工判断是不是拍摄条件变了
    expect(result.meanDelta).toBeCloseTo(100, 5)
    expect(result.changedRatio).toBe(1)
  })

  it('框选区域太小 → 不可比对，并说明需要多大', () => {
    const result = compareFrames({
      before: luma(40, 40, 100),
      after: luma(40, 40, 100),
      width: 40,
      height: 40,
      region: { x: 0, y: 0, w: 0.05, h: 0.05 },
    })
    expect(result.status).toBe('incomparable')
    expect(result.summary).toContain('太小')
  })
})

describe('口径与边界（不许越界）', () => {
  const all = [
    compareFrames({ before: luma(40, 40, 120), after: luma(40, 40, 120), width: 40, height: 40, region: REGION }),
    compareFrames({
      before: luma(40, 40, (x) => (x < 20 ? 100 : 140)),
      after: luma(40, 40, (x) => (x < 20 ? 100 : 180)),
      width: 40,
      height: 40,
      region: REGION,
    }),
    compareFrames({ before: luma(40, 40, 60), after: luma(40, 40, 160), width: 40, height: 40, region: REGION }),
  ]

  it('结论本身不含毫米/宽度/AI/识别这类越界措辞（边界说明里只允许以"不给…"的形式出现）', () => {
    for (const result of all) {
      expect(result.summary).not.toMatch(/毫米|mm|宽度|AI|识别/)
      // 边界说明可以提这些词，但只能是否定式；一旦出现"数值 + 毫米"就是越界
      const notes = result.reasons.join(' ')
      expect(notes).not.toMatch(/\d+(\.\d+)?\s*(mm|毫米)/)
      expect(notes).not.toMatch(/AI|人工智能|智能识别/)
    }
  })

  it('每条结论都带"不是裂缝识别 / 不给物理量 / 不自动生成预警"的边界说明', () => {
    for (const result of all) {
      const text = result.reasons.join(' ')
      expect(text).toContain('不是裂缝识别')
      expect(text).toContain('不给宽度')
      expect(text).toContain('不会自动生成正式结构预警')
    }
  })

  it('边界清单本身也守住这三条', () => {
    const text = COMPARE_BOUNDARIES.join(' ')
    expect(text).toContain('不是裂缝识别')
    expect(text).toContain('不给宽度')
    expect(text).toContain('不会自动生成正式结构预警')
  })

  it('阈值是演示口径且写出来可核对', () => {
    expect(DEFAULT_COMPARE_OPTIONS.pixelDelta).toBeGreaterThan(0)
    expect(DEFAULT_COMPARE_OPTIONS.changedRatio).toBeGreaterThan(0)
    expect(DEFAULT_COMPARE_OPTIONS.exposureTolerance).toBeGreaterThan(0)
  })
})

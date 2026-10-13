import { expect, it } from 'vitest'
import { compareFrames } from '@/core/media/compare'
import { maskRgba } from '@/core/media/mask'
import { compareRecordOf } from '@/core/media/analysis'

function input() {
  const before = new Uint8Array(100).fill(80)
  const after = before.slice()
  after[0] = 110; after[1] = 98; after[2] = 97; after[99] = 150
  return { before, after, width: 10, height: 10, region: { x: 0, y: 0, w: .5, h: .5 }, options: { minPixels: 1 }, includeMask: true }
}

it('掩膜计数与实际比例完全一致，区域外和未达阈值像素透明', () => {
  const result = compareFrames(input())
  expect(result.sampled).toBe(25)
  expect(result.mask?.data.reduce((a, b) => a + b, 0)).toBe(result.changedRatio * result.sampled)
  expect(result.mask?.data[1]).toBe(1) // 等于18，也纳入统计
  expect(result.mask?.data[2]).toBe(0)
  expect(result.mask?.data[99]).toBe(0)
  const rgba = maskRgba(result.mask!)
  expect([...rgba.slice(4, 8)]).toEqual([255, 109, 34, 220])
  expect(rgba[99 * 4 + 3]).toBe(0)
})

it('曝光不可比、尺寸不匹配不发布掩膜', () => {
  const a = input()
  expect(compareFrames({ ...a, after: new Uint8Array(100).fill(180) }).mask).toBeUndefined()
  expect(compareFrames({ ...a, after: new Uint8Array(10) }).mask).toBeUndefined()
})

it('会话记录保留同一次计算掩膜，不重算第二套差异', () => {
  const a = input()
  const result = compareFrames(a)
  const record = compareRecordOf({ pointId: 'p', beforeId: 'a', afterId: 'b', region: a.region, result })
  expect(record.mask).toBe(result.mask)
  expect(record.changedRatio).toBe(result.changedRatio)
})

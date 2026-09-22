/**
 * 视口坐标换算测试。
 * 这三步最容易算错：屏幕→内容要扣掉平移与缩放，缩放要以光标下的点为锚点。
 */
import { describe, expect, it } from 'vitest'
import { MAX_SCALE, MIN_SCALE, VIEW_H, VIEW_W, clamp, toContent, toNormalized, zoomAnchor } from '@/core/map/coords'

describe('视口坐标换算', () => {
  it('未缩放未平移时，内容坐标等于用户坐标', () => {
    expect(toContent({ x: 300, y: 200 }, { scale: 1, tx: 0, ty: 0 })).toEqual({ x: 300, y: 200 })
  })

  it('内容坐标要扣掉平移量，并按缩放倍数还原', () => {
    // 放大 2 倍、右移 100、下移 50：用户在 300 处对应内容 (300-100)/2 = 100
    expect(toContent({ x: 300, y: 250 }, { scale: 2, tx: 100, ty: 50 })).toEqual({ x: 100, y: 100 })
  })

  it('归一化坐标按底图尺寸换算并收敛到 0~1', () => {
    expect(toNormalized({ x: VIEW_W / 2, y: VIEW_H / 2 })).toEqual({ x: 0.5, y: 0.5 })
    expect(toNormalized({ x: -80, y: VIEW_H + 300 })).toEqual({ x: 0, y: 1 })
  })

  it('缩放锚点解算后，锚点下的内容点在屏幕上不动', () => {
    const user = { x: 400, y: 300 }
    const view = { scale: 1.5, tx: 20, ty: 10 }
    const content = toContent(user, view)
    const next = 3
    const anchor = zoomAnchor(user, content, next)
    // 用新状态把同一个用户坐标换算回去，应当还是同一个内容点
    expect(toContent(user, { scale: next, tx: anchor.tx, ty: anchor.ty })).toEqual(content)
  })

  it('缩放倍数被限制在上下限内', () => {
    expect(clamp(0.1, MIN_SCALE, MAX_SCALE)).toBe(MIN_SCALE)
    expect(clamp(99, MIN_SCALE, MAX_SCALE)).toBe(MAX_SCALE)
    expect(clamp(2, MIN_SCALE, MAX_SCALE)).toBe(2)
  })
})

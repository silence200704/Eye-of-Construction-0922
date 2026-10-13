/**
 * 悬浮小瞳入口的几何与轻点判定。
 *
 * 这一组守的是最容易出错的四件事：
 * 拖动时误触打开、拖出视口找不回来、窗口变小后留在屏幕外、键盘微调越过边界。
 * 纯函数直接跑用例，不需要浏览器。
 */
import { describe, expect, it } from 'vitest'
import {
  EDGE_MARGIN,
  ENTRY_SIZE,
  NUDGE_STEP,
  POSITION_KEY,
  clampPosition,
  defaultPosition,
  dockPosition,
  isTap,
  nudge,
  parseStoredPosition,
  tapThreshold,
} from '@/components/assistant/floating'

const VIEWPORT = { width: 1280, height: 720 }
const SIZE = { width: ENTRY_SIZE, height: ENTRY_SIZE }

describe('轻点与拖动的区分', () => {
  it('位移在阈值内算轻点，超过就算拖动', () => {
    expect(isTap({ x: 100, y: 100 }, { x: 104, y: 103 }, 6)).toBe(true)
    // 阈值取闭区间：正好 6px 仍算轻点，7px 才算拖动
    expect(isTap({ x: 100, y: 100 }, { x: 106, y: 100 }, 6)).toBe(true)
    expect(isTap({ x: 100, y: 100 }, { x: 107, y: 100 }, 6)).toBe(false)
    expect(isTap({ x: 100, y: 100 }, { x: 100, y: 107 }, 6)).toBe(false)
  })

  it('纵向拖动同样算拖动（拇指拖拽很少是纯水平）', () => {
    expect(isTap({ x: 100, y: 100 }, { x: 101, y: 130 }, 6)).toBe(false)
  })

  it('窄屏阈值放宽，避免手指抖动被当成点击', () => {
    expect(tapThreshold(true)).toBeGreaterThan(tapThreshold(false))
    // 同一个 10px 抖动：窄屏算轻点，桌面算拖动
    expect(isTap({ x: 0, y: 0 }, { x: 10, y: 0 }, tapThreshold(true))).toBe(true)
    expect(isTap({ x: 0, y: 0 }, { x: 10, y: 0 }, tapThreshold(false))).toBe(false)
  })
})

describe('视口约束', () => {
  it('左上越界会被拉回，并留出间距', () => {
    expect(clampPosition({ x: -50, y: -50 }, VIEWPORT, SIZE)).toEqual({ x: EDGE_MARGIN, y: EDGE_MARGIN })
  })

  it('右下越界会把整个悬浮球拉回可见区域（不是只露出左上角）', () => {
    const clamped = clampPosition({ x: 2000, y: 2000 }, VIEWPORT, SIZE)
    expect(clamped.x + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(clamped.y + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height)
    expect(clamped).toEqual({ x: VIEWPORT.width - SIZE.width - EDGE_MARGIN, y: VIEWPORT.height - SIZE.height - EDGE_MARGIN })
  })

  it('视口比悬浮球还小时不会算出负数坐标', () => {
    const tiny = { width: 40, height: 40 }
    expect(clampPosition({ x: 10, y: 10 }, tiny, SIZE)).toEqual({ x: EDGE_MARGIN, y: EDGE_MARGIN })
  })

  it('窗口变大后原位置仍在视口内（不需要挪动）', () => {
    const wide = { width: 1920, height: 1080 }
    expect(clampPosition({ x: 400, y: 300 }, wide, SIZE)).toEqual({ x: 400, y: 300 })
  })

  it('默认落在左下角：避开右侧「楼栋档案」正文与地图缩放控件', () => {
    const spot = defaultPosition(VIEWPORT, SIZE)
    expect(spot.x).toBe(EDGE_MARGIN)
    expect(spot.y).toBeGreaterThan(VIEWPORT.height / 2)
    // 右上角是地图缩放控件的位置，默认落点离它远
    expect(spot.x).toBeLessThan(VIEWPORT.width / 2)
  })

  it('默认落点是完整可见的（不是只露出一角）', () => {
    const spot = defaultPosition(VIEWPORT, SIZE)
    expect(spot.x + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(spot.y + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height)
  })
})

describe('松手后靠边停靠', () => {
  it('偏左的松手点贴左边缘，纵向保持不变', () => {
    expect(dockPosition({ x: 300, y: 200 }, VIEWPORT, SIZE)).toEqual({ x: EDGE_MARGIN, y: 200 })
  })

  it('偏右的松手点贴右边缘', () => {
    expect(dockPosition({ x: 900, y: 260 }, VIEWPORT, SIZE)).toEqual({
      x: VIEWPORT.width - SIZE.width - EDGE_MARGIN,
      y: 260,
    })
  })

  it('正好压在中线时按右侧处理（不会来回抖）', () => {
    const center = VIEWPORT.width / 2 - SIZE.width / 2
    expect(dockPosition({ x: center, y: 100 }, VIEWPORT, SIZE).x).toBe(VIEWPORT.width - SIZE.width - EDGE_MARGIN)
  })

  it('停靠后一定完整落在视口内', () => {
    for (const x of [-40, 0, 640, 1279, 1400]) {
      const docked = dockPosition({ x, y: 900 }, VIEWPORT, SIZE)
      expect(docked.x).toBeGreaterThanOrEqual(0)
      expect(docked.x + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width)
      expect(docked.y + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height)
    }
  })

  it('窄屏（全屏面板形态）下同样只贴左右两侧', () => {
    const phone = { width: 420, height: 720 }
    const left = dockPosition({ x: 40, y: 100 }, phone, SIZE)
    const right = dockPosition({ x: 300, y: 100 }, phone, SIZE)
    expect(left.x).toBe(EDGE_MARGIN)
    expect(right.x).toBe(phone.width - SIZE.width - EDGE_MARGIN)
  })
})

describe('键盘微调', () => {
  it('按步长移动并保持可见', () => {
    expect(nudge({ x: 100, y: 100 }, { x: NUDGE_STEP, y: 0 }, VIEWPORT, SIZE)).toEqual({ x: 112, y: 100 })
    expect(nudge({ x: 100, y: 100 }, { x: 0, y: -NUDGE_STEP }, VIEWPORT, SIZE)).toEqual({ x: 100, y: 88 })
  })

  it('顶到边界后继续按不会越界', () => {
    const atEdge = nudge({ x: VIEWPORT.width, y: VIEWPORT.height }, { x: NUDGE_STEP, y: NUDGE_STEP }, VIEWPORT, SIZE)
    expect(atEdge.x + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(atEdge.y + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height)
  })
})

describe('位置缓存', () => {
  it('正常缓存能读回来', () => {
    expect(parseStoredPosition(JSON.stringify({ x: 320, y: 210 }))).toEqual({ x: 320, y: 210 })
  })

  it('没存过、空串、坏 JSON、缺字段、非数字都退回 null（用默认落点）', () => {
    expect(parseStoredPosition(null)).toBeNull()
    expect(parseStoredPosition('   ')).toBeNull()
    expect(parseStoredPosition('{ not json')).toBeNull()
    expect(parseStoredPosition('{"x":10}')).toBeNull()
    expect(parseStoredPosition('{"x":"10","y":20}')).toBeNull()
    expect(parseStoredPosition('{"x":null,"y":20}')).toBeNull()
  })

  it('非有限值（NaN / Infinity）不算有效缓存', () => {
    expect(parseStoredPosition('{"x":1e999,"y":0}')).toBeNull()
  })

  it('缓存键是界面偏好，与演示数据分开', () => {
    expect(POSITION_KEY).toContain('zhutong-demo/')
  })
})

import { workspaceStorageKey } from '@/core/demo/workspace'
/**
 * 悬浮小瞳入口的几何与"轻点 / 拖动"判定。
 *
 * 单独抽成纯函数而不是写在组件里，是因为这几件最容易出错的事全在这里：
 * 拖动时误触打开、拖出视口再也找不回来、窗口变化后留在屏幕外、键盘微调越界。
 * 纯函数可以脱离浏览器直接跑用例（`tests/assistant/floating.test.ts`）。
 *
 * 交互口径参考 `hnuahe_yingxin-main/frontend/src/composables/useDrag.ts`：
 * 位移超过阈值才算拖动，否则按轻点处理；元素始终整体留在视口内。
 */

/** 轻点 / 拖动的位移阈值：窄屏手感放宽一点，避免手指抖动被当成点击 */
export function tapThreshold(narrow: boolean): number {
  return narrow ? 12 : 6
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** 元素与视口边的最小间距：留出焦点环与阴影，不让它贴死边缘 */
export const EDGE_MARGIN = 8

/** 悬浮入口尺寸：逻辑（夹紧 / 停靠）与样式（CSS 变量）共用这一个数 */
export const ENTRY_SIZE = 80

/**
 * 位移是否只算轻点。
 * 横纵任一方向超过阈值就算拖动 —— 拇指拖拽很少是纯水平的。
 */
export function isTap(start: Point, end: Point, threshold: number): boolean {
  return Math.abs(end.x - start.x) <= threshold && Math.abs(end.y - start.y) <= threshold
}

/** 把坐标夹进视口：元素整体可见，右下角同样要留出间距。 */
export function clampPosition(position: Point, viewport: Size, size: Size, margin = EDGE_MARGIN): Point {
  const maxX = Math.max(margin, viewport.width - size.width - margin)
  const maxY = Math.max(margin, viewport.height - size.height - margin)
  return {
    x: Math.min(Math.max(position.x, margin), maxX),
    y: Math.min(Math.max(position.y, margin), maxY),
  }
}

/**
 * 默认落点：**左下角**。
 *
 * 原本默认右下角，实测会压住校园地图右侧「楼栋档案」正文（责任人、替补人员、资料来源那几行）。
 * 左下角落在左侧导航栏的脚注区，既不挡楼栋档案，也不碰地图的缩放控件与图例。
 */
export function defaultPosition(viewport: Size, size: Size, margin = EDGE_MARGIN): Point {
  return clampPosition({ x: margin, y: viewport.height - size.height - margin }, viewport, size, margin)
}

/**
 * 松手后靠边停靠：贴向更近的那一侧（左右），纵向保持不变。
 * 靠边之后不再压在正文中间，也给"再拖回来"留了明确的两个落点。
 */
export function dockPosition(position: Point, viewport: Size, size: Size, margin = EDGE_MARGIN): Point {
  const left = margin
  const right = Math.max(margin, viewport.width - size.width - margin)
  const center = position.x + size.width / 2
  return clampPosition({ x: center < viewport.width / 2 ? left : right, y: position.y }, viewport, size, margin)
}

/** 键盘微调：方向键按步长移动，同样受视口约束。 */
export function nudge(position: Point, delta: Point, viewport: Size, size: Size, margin = EDGE_MARGIN): Point {
  return clampPosition({ x: position.x + delta.x, y: position.y + delta.y }, viewport, size, margin)
}

/** 键盘步长：按住 Shift 走大步，方便快速挪开。 */
export const NUDGE_STEP = 12
export const NUDGE_STEP_LARGE = 48

/**
 * 解析本地缓存里的位置。
 * 任何非法内容都当作"没存过"退回默认落点 —— 缓存坏了不该让入口消失。
 */
export function parseStoredPosition(raw: string | null): Point | null {
  if (raw === null || raw.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as { x?: unknown; y?: unknown }
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return null
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return null
    return { x: candidate.x, y: candidate.y }
  } catch {
    return null
  }
}

/** 位置缓存键：与演示身份、数据模式一样，属于本机界面偏好 */
export const POSITION_KEY = workspaceStorageKey('zhutong-demo/assistant-entry-position')

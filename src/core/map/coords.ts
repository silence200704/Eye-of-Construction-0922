/**
 * 平面图视口的坐标换算与缩放锚点（纯函数）。
 *
 * 视口状态是「缩放 scale + 平移 tx/ty」，这里的每个函数都只做一次换算：
 * 屏幕坐标 → 内容坐标 → 归一化坐标，以及"缩放时让光标下的点保持不动"的锚点解算。
 * 抽出来单独放，是因为这几步最容易算错，而它们不依赖 Vue 与 DOM（除读 CTM 外）。
 */
import type { NormPoint } from '@/types/domain'

/** 底图内容坐标尺寸：归一化坐标 × 这个尺寸得到 SVG 用户坐标 */
export const VIEW_W = 1000
export const VIEW_H = 700

export const MIN_SCALE = 0.6
export const MAX_SCALE = 8
export const ZOOM_STEP = 1.15

/** 视口状态：缩放倍数与平移量（SVG 用户坐标系）。 */
export interface ViewportState {
  scale: number
  tx: number
  ty: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 屏幕坐标 → SVG 用户坐标；取不到 transform 时返回 null（元素未挂载或已卸载）。 */
export function screenToUser(svg: SVGSVGElement | null, clientX: number, clientY: number): { x: number; y: number } | null {
  if (svg === null) return null
  const ctm = svg.getScreenCTM()
  if (ctm === null) return null
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const mapped = point.matrixTransform(ctm.inverse())
  return { x: mapped.x, y: mapped.y }
}

/** 屏幕坐标 → 内容坐标：先按 CTM 换算，再扣掉当前平移与缩放。 */
export function toContent(user: { x: number; y: number }, view: ViewportState): { x: number; y: number } {
  return { x: (user.x - view.tx) / view.scale, y: (user.y - view.ty) / view.scale }
}

/** 内容坐标 → 归一化坐标（0~1），越界时收敛。 */
export function toNormalized(content: { x: number; y: number }): NormPoint {
  return { x: clamp(content.x / VIEW_W, 0, 1), y: clamp(content.y / VIEW_H, 0, 1) }
}

/**
 * 缩放锚点：以内容点 anchor 为不动点解出新的平移量。
 * 不做这一步的话，滚轮缩放会以原点为中心，光标下的位置会跑掉。
 */
export function zoomAnchor(user: { x: number; y: number }, content: { x: number; y: number }, nextScale: number): { tx: number; ty: number } {
  return { tx: user.x - content.x * nextScale, ty: user.y - content.y * nextScale }
}

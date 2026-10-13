/** 2D 与 3D 共用的校园示意场地元素；均为归一化坐标，不是实测位置。 */
export interface SiteRect { x: number; y: number; w: number; h: number }

export const CAMPUS_ROADS: readonly SiteRect[] = [
  { x: 0.06, y: 0.425, w: 0.88, h: 0.03 },
  { x: 0.33, y: 0.06, w: 0.022, h: 0.86 },
  { x: 0.655, y: 0.06, w: 0.022, h: 0.86 },
  { x: 0.06, y: 0.84, w: 0.88, h: 0.026 },
]

export const CAMPUS_GREENS: readonly SiteRect[] = [
  { x: 0.075, y: 0.49, w: 0.15, h: 0.3 },
  { x: 0.515, y: 0.53, w: 0.11, h: 0.27 },
  { x: 0.7, y: 0.11, w: 0.19, h: 0.24 },
]

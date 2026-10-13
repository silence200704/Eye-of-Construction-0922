/**
 * 3D 场景的类型、配色与尺寸常量：引擎（sceneBuild）、内部几何（sceneParts）、外壳（sceneShell）共用。
 * 放一处是为了避免三边各定义一份颜色或视图类型，改一处忘两处。
 */
import type { CampusModel } from "@/core/spatial/project"

export type ViewMode = "whole" | "floor" | "exploded"
export type SceneScope = { kind: "campus" } | { kind: "building"; buildingId: string }

export interface SceneUpdate {
  model: CampusModel
  scope: SceneScope
  mode: ViewMode
  /** 当前聚焦的层（按楼栋内序号，0 起） */
  activeLevelIndex: number
  selectedPointId: string
  /** 选中测点的**实时信息摘要**（读数 + 采样时间），画在编号下面；空串则不画 */
  selectedSummary: string
}

export interface PickResult {
  pointId: string
  buildingId: string
  floorId: string
}

export interface SceneHandle {
  update(input: SceneUpdate): void
  resize(width: number, height: number): void
  pick(clientX: number, clientY: number): PickResult | null
  resetView(): void
  /** 显式讲解动作才聚焦测点；普通选中仍保留用户旋转后的视角。 */
  focusPoint(pointId: string): boolean
  dispose(): void
}

export const EVENT_COLOR: Record<string, number> = { red: 0xc0392b, orange: 0xd97b18, yellow: 0xc9a227 }

export const MARKER_COLOR: Record<string, number> = {
  crack: 0x0f6e7c,
  tilt: 0x2f6f9e,
  vibration: 0x8a6210,
  temp_humidity: 0x1e7a54,
  manual_check: 0x5a6b73,
}

/** 演示楼栋配色；只表达可辨认的建筑体量，不暗示真实外立面。 */
const BUILDING_TINT: Record<string, number> = {
  B01: 0xd4bb9f, // 综合楼 · 暖砂岩
  B02: 0xa9bea9, // 实验楼 · 鼠尾草绿
  B03: 0x7eafbe, // 教学楼 · 青灰蓝
  B04: 0xc99d86, // 体育馆 · 陶土色
}
const TINT_FALLBACK = 0xd7dee2

export const SELECTED = 0x0b5762

/** 屋顶色：比体量深一档，让每栋楼在校园总览里读成一个封闭体量 */
export const ROOF_TINT = 0x58727d

export function tintOf(code: string): number {
  return BUILDING_TINT[code] ?? TINT_FALLBACK
}

export function eventColor(level: string | null | undefined): number | null {
  if (level === null || level === undefined) return null
  return EVENT_COLOR[level] ?? null
}


/**
 * 细节量：同一套几何在校园总览与单栋视图下画到什么程度。
 * 校园总览用矮墙、不铺文字（四栋一起看时文字会糊成一片），单栋视图给足信息。
 */
export interface LevelDetail {
  zoneLabels: boolean
  deviceLabels: boolean
}

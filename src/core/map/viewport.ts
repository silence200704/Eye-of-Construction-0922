/**
 * SVG 平面图视口：滚轮缩放、指针拖拽平移，并把屏幕坐标换算为归一化坐标。
 * 归一化坐标以底图左上角为原点、取值 0~1，与 Leaflet CRS.Simple 坐标可互转，
 * 便于后续按方案 S12 切换到 Leaflet 地图而不改动点位数据。
 *
 * 分工：坐标换算与锚点解算在 coords.ts（纯函数）；缩放、平移各自一个控制器；
 * 本文件只把三者接到一起并暴露给页面。
 */
import { computed, ref, type Ref } from 'vue'
import type { NormPoint } from '@/types/domain'
import { MAX_SCALE, MIN_SCALE, ZOOM_STEP, clamp, screenToUser, toContent, toNormalized, zoomAnchor } from './coords'

export { MIN_SCALE, MAX_SCALE, ZOOM_STEP, VIEW_H, VIEW_W } from './coords'

interface ViewRefs {
  svgRef: Ref<SVGSVGElement | null>
  scale: Ref<number>
  tx: Ref<number>
  ty: Ref<number>
}

/** 缩放：滚轮与 +/- 按钮共用一条路径，锚点固定光标（或视口中心）下的内容点。 */
function useZoomController({ svgRef, scale, tx, ty }: ViewRefs) {
  function zoomAround(clientX: number, clientY: number, factor: number): void {
    const user = screenToUser(svgRef.value, clientX, clientY)
    if (user === null) return
    const next = clamp(scale.value * factor, MIN_SCALE, MAX_SCALE)
    if (next === scale.value) return
    const current = toContent(user, { scale: scale.value, tx: tx.value, ty: ty.value })
    const anchor = zoomAnchor(user, current, next)
    scale.value = next
    tx.value = anchor.tx
    ty.value = anchor.ty
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    zoomAround(event.clientX, event.clientY, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
  }

  /** 以视口中心为锚点缩放，供 +/- 按钮使用 */
  function zoomButton(factor: number): void {
    const svg = svgRef.value
    if (svg === null) return
    const rect = svg.getBoundingClientRect()
    zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  function reset(): void {
    scale.value = 1
    tx.value = 0
    ty.value = 0
  }

  return { onWheel, zoomButton, reset }
}

/** 平移：按下时记下指针位置与当前变换比例，移动时按比例换算，避免缩放后拖动速度不匹配。 */
function usePanController({ svgRef, tx, ty }: ViewRefs) {
  const panning = ref(false)
  let origin: { x: number; y: number; tx: number; ty: number; a: number; d: number } | null = null

  function onPanStart(event: PointerEvent): void {
    const svg = svgRef.value
    if (svg === null) return
    const ctm = svg.getScreenCTM()
    if (ctm === null) return
    origin = { x: event.clientX, y: event.clientY, tx: tx.value, ty: ty.value, a: ctm.a, d: ctm.d }
    panning.value = true
    svg.setPointerCapture(event.pointerId)
  }

  function onPanMove(event: PointerEvent): void {
    if (origin === null || !panning.value) return
    if (origin.a === 0 || origin.d === 0) return
    tx.value = origin.tx + (event.clientX - origin.x) / origin.a
    ty.value = origin.ty + (event.clientY - origin.y) / origin.d
  }

  function onPanEnd(event: PointerEvent): void {
    const svg = svgRef.value
    if (svg !== null && svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId)
    }
    panning.value = false
    origin = null
  }

  return { panning, onPanStart, onPanMove, onPanEnd }
}

export function useSvgViewport() {
  const svgRef = ref<SVGSVGElement | null>(null)
  const scale = ref(1)
  const tx = ref(0)
  const ty = ref(0)
  const refs: ViewRefs = { svgRef, scale, tx, ty }

  const transform = computed(() => `translate(${tx.value} ${ty.value}) scale(${scale.value})`)
  const zoom = useZoomController(refs)
  const pan = usePanController(refs)

  /** 屏幕坐标直接换算成归一化坐标；取不到 SVG 时返回 null。 */
  function toNormalizedAt(clientX: number, clientY: number): NormPoint | null {
    const user = screenToUser(svgRef.value, clientX, clientY)
    if (user === null) return null
    return toNormalized(toContent(user, { scale: scale.value, tx: tx.value, ty: ty.value }))
  }

  return {
    svgRef,
    transform,
    scale,
    panning: pan.panning,
    toNormalized: toNormalizedAt,
    onWheel: zoom.onWheel,
    onPanStart: pan.onPanStart,
    onPanMove: pan.onPanMove,
    onPanEnd: pan.onPanEnd,
    reset: zoom.reset,
    zoomButton: zoom.zoomButton,
  }
}

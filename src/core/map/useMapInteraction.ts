/**
 * 平面图交互：指针拖拽平移、滚轮缩放、点击落点、占位框拖拽。
 * 校园图与楼层图共用同一套交互，避免两处各写一遍。
 */
import { ref } from 'vue'
import type { NormPoint } from '@/types/domain'
import { useSvgViewport } from './viewport'

export interface MapInteractionOptions {
  /** 落点模式：此模式下点击空白处是落点而不是取消选中 */
  pickable: () => boolean
  /** 是否存在可拖拽的占位对象 */
  hasDraft: () => boolean
  onPick: (point: NormPoint) => void
  onDraftMove: (point: NormPoint) => void
}

export function useMapInteraction(options: MapInteractionOptions) {
  const vp = useSvgViewport()
  const draggingDraft = ref(false)
  const downAt = ref<{ x: number; y: number } | null>(null)

  function onPointerDown(event: PointerEvent): void {
    downAt.value = { x: event.clientX, y: event.clientY }
    vp.onPanStart(event)
  }

  function onPointerMove(event: PointerEvent): void {
    if (draggingDraft.value && options.hasDraft()) {
      const point = vp.toNormalized(event.clientX, event.clientY)
      if (point !== null) options.onDraftMove(point)
      return
    }
    vp.onPanMove(event)
  }

  /** 抬起时若几乎没有位移，按一次点击处理：落点模式下落点，否则什么都不做。 */
  function onPointerUp(event: PointerEvent): void {
    const moved = downAt.value === null ? 0 : Math.hypot(event.clientX - downAt.value.x, event.clientY - downAt.value.y)
    if (draggingDraft.value) {
      draggingDraft.value = false
      const svg = vp.svgRef.value
      if (svg !== null && svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
    } else {
      vp.onPanEnd(event)
      if (options.pickable() && moved < 4) {
        const point = vp.toNormalized(event.clientX, event.clientY)
        if (point !== null) options.onPick(point)
      }
    }
    downAt.value = null
  }

  function onDraftDown(event: PointerEvent): void {
    if (!options.hasDraft()) return
    event.stopPropagation()
    const svg = vp.svgRef.value
    if (svg === null) return
    draggingDraft.value = true
    svg.setPointerCapture(event.pointerId)
  }

  /** 点击图中的业务对象；落点模式下不响应选中，避免落点时误选。 */
  function onObjectDown(event: PointerEvent, select: () => void): void {
    event.stopPropagation()
    if (options.pickable()) return
    select()
  }

  return {
    svgRef: vp.svgRef,
    transform: vp.transform,
    panning: vp.panning,
    onWheel: vp.onWheel,
    reset: vp.reset,
    zoomButton: vp.zoomButton,
    draggingDraft,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDraftDown,
    onObjectDown,
  }
}

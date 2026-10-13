<script setup lang="ts">
/**
 * 在照片上拖出一块区域（归一化坐标，原点左上）。
 *
 * 只负责"把手的动作变成一块区域"：不判定、不计算、不猜。
 * 拖出来的框太小（`isUsableRegion` 判不过）就当作误触丢掉，让用户重画，
 * 而不是拿一个几十像素的框去算出一个没意义的百分比。
 */
import { ref } from 'vue'
import { clampRegion, isUsableRegion, type Region } from '@/core/media/compare'

defineProps<{ hint?: string }>()
const emit = defineEmits<{ select: [region: Region] }>()

const layerEl = ref<HTMLElement | null>(null)
/** 手指/鼠标按下时的起点（归一化） */
const from = ref<{ x: number; y: number } | null>(null)
/** 正在拖的框（归一化） */
const box = ref<Region | null>(null)

/** 指针位置 → 归一化坐标；超出图片的部分夹到 0~1。 */
function pointOf(event: PointerEvent): { x: number; y: number } {
  const rect = layerEl.value?.getBoundingClientRect()
  if (rect === undefined || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
  const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
  const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
  return { x, y }
}

/**
 * 指针捕获是**尽力而为**：拿不到也照样能拖（坐标全从元素矩形算），
 * 但真机上有一种情况会抛错 —— 指针在两次事件之间已经抬起。所以这里不让它把拖动打断。
 */
function capture(id: number, on: boolean): void {
  const el = layerEl.value
  if (el === null) return
  try {
    if (on) el.setPointerCapture(id)
    else el.releasePointerCapture(id)
  } catch {
    // 无关紧要：没有捕获时事件仍然落在同一个元素上
  }
}

function onDown(event: PointerEvent): void {
  const start = pointOf(event)
  from.value = start
  box.value = { x: start.x, y: start.y, w: 0, h: 0 }
  capture(event.pointerId, true)
}

function onMove(event: PointerEvent): void {
  const start = from.value
  if (start === null) return
  const now = pointOf(event)
  box.value = clampRegion({
    x: Math.min(start.x, now.x),
    y: Math.min(start.y, now.y),
    w: Math.abs(now.x - start.x),
    h: Math.abs(now.y - start.y),
  })
}

function onUp(event: PointerEvent): void {
  const drawn = box.value
  from.value = null
  box.value = null
  if (drawn !== null && isUsableRegion(drawn)) emit('select', clampRegion(drawn))
  capture(event.pointerId, false)
}
</script>

<template>
  <div
    ref="layerEl"
    class="layer"
    role="application"
    :aria-label="hint ?? '在照片上按住并拖动，框出一块区域'"
    @pointerdown.prevent="onDown"
    @pointermove.prevent="onMove"
    @pointerup.prevent="onUp"
    @pointercancel="onUp"
  >
    <span v-if="box !== null" class="draft" :style="{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }" />
    <span v-else class="hint">{{ hint ?? '按住拖动，框出一块区域' }}</span>
  </div>
</template>

<style scoped>
.layer { position: absolute; inset: 0; cursor: crosshair; touch-action: none; }
.draft { position: absolute; border: 1px dashed var(--brand-600); background: rgb(37 99 235 / 12%); }
.hint {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: var(--r-sm);
  background: rgb(15 23 42 / 62%);
  color: #fff;
  font-size: 10.5px;
}
</style>

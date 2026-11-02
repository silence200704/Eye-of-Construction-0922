<script setup lang="ts">
/**
 * 3D 画布的宿主组件：负责生命周期（动态加载、尺寸变化、释放）与指针拾取，
 * 场景本身（几何、相机、灯光）在 `sceneBuild.ts` 里，Three 只在那一个模块出现。
 *
 * **只在切到 3D 时才 import 引擎**，所以 Three 不会进首屏包；WebGL 不可用时
 * 立刻把原因抛给上层，由上层退回 2D 平面图，而不是留一块黑屏。
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CampusModel } from '@/core/spatial/project'
import { installationViewOf } from '@/core/spatial/installation'
import type { Device } from '@/types/domain'
import type { PickResult, SceneHandle, SceneScope, ViewMode } from './sceneBuild'
const WallSectionCard = defineAsyncComponent(() => import('./installation/WallSectionCard.vue'))

const props = defineProps<{
  model: CampusModel
  scope: SceneScope
  mode: ViewMode
  activeLevelIndex: number
  selectedPointId: string
  selectedSummary: string
  selectedZoneKey: string
  selectedDevice: Device | null
  focusToken: number
}>()

const emit = defineEmits<{ pick: [result: PickResult]; unavailable: [reason: string] }>()

const host = ref<HTMLDivElement | null>(null)
const state = ref<'loading' | 'ready' | 'failed'>('loading')
const selectedWallPoint = computed(() => props.model.buildings
  .flatMap((building) => building.levels.flatMap((level) => level.markers))
  .find((marker) => marker.point.id === props.selectedPointId && marker.mount !== null))
const installation = computed(() => {
  const marker = selectedWallPoint.value
  return marker?.mount === null || marker === undefined ? null
    : installationViewOf(marker.point, props.selectedDevice, marker.mount, marker.mountHeight)
})
let handle: SceneHandle | null = null
let observer: ResizeObserver | null = null

/** WebGL 可用性：拿不到上下文就不再往下走，避免"能渲染但全黑"这种更糟的假象 */
function hasWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null
  } catch {
    return false
  }
}

function pushUpdate(): void {
  handle?.update({
    model: props.model,
    scope: props.scope,
    mode: props.mode,
    activeLevelIndex: props.activeLevelIndex,
    selectedPointId: props.selectedPointId,
    selectedSummary: props.selectedSummary,
    selectedZoneKey: props.selectedZoneKey,
  })
}

let pointerDownAt: { x: number; y: number } | null = null

function onPointerDown(event: PointerEvent): void {
  pointerDownAt = { x: event.clientX, y: event.clientY }
}

function onPointerUp(event: PointerEvent): void {
  const down = pointerDownAt
  pointerDownAt = null
  if (handle === null || down === null) return
  // 只有几乎没移动的点击才拾取；拖动/平移交给 OrbitControls，不误选房间或设备。
  if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return
  const hit = handle.pick(event.clientX, event.clientY)
  if (hit !== null) emit('pick', hit)
}

onMounted(async () => {
  const element = host.value
  if (element === null) return
  if (!hasWebgl()) {
    state.value = 'failed'
    emit('unavailable', '本机浏览器当前无法使用 WebGL，已改回 2D 平面图；原平面图与档案操作不受影响。')
    return
  }
  try {
    const engine = await import('./sceneBuild')
    if (host.value === null) return
    const scene = engine.createScene(element)
    handle = scene
    const rect = element.getBoundingClientRect()
    scene.resize(rect.width, rect.height)
    pushUpdate()
    observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect()
      handle?.resize(box.width, box.height)
    })
    observer.observe(element)
    state.value = 'ready'
  } catch (cause) {
    state.value = 'failed'
    emit('unavailable', `3D 场景加载失败，已改回 2D 平面图：${cause instanceof Error ? cause.message : String(cause)}`)
  }
})

watch(
  () => [props.model, props.scope, props.mode, props.activeLevelIndex, props.selectedPointId, props.selectedSummary, props.selectedZoneKey],
  pushUpdate,
  { deep: false },
)
watch(() => props.focusToken, async () => {
  await nextTick()
  pushUpdate()
  if (props.selectedPointId !== '') handle?.focusPoint(props.selectedPointId)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  handle?.dispose()
  handle = null
})
</script>

<template>
  <div class="scene">
    <div
      ref="host"
      class="canvas"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="pointerDownAt = null"
    />
    <div v-if="state === 'ready'" class="scene-meta" aria-hidden="true">
      <span class="scene-meta__dot" />{{ scope.kind === 'campus' ? '校园总览' : '楼层剖面' }} · 档案示意
    </div>
    <WallSectionCard v-if="state === 'ready' && installation !== null" :view="installation" />
    <p v-if="state === 'loading'" class="muted overlay-text">正在加载 3D 场景…</p>
    <p v-else-if="state === 'failed'" class="muted overlay-text">3D 场景不可用，已退回 2D 平面图</p>
    <button type="button" class="reset" @click="handle?.resetView()">恢复视角</button>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: linear-gradient(145deg, #e7f0f2, #f5f8f7);
}

.canvas {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* canvas 自己也算上：块级显示 + 撑满容器，避免行内基线留缝或溢出容器 */
.canvas canvas {
  display: block;
}

.overlay-text {
  position: absolute;
  inset: auto 0 50% 0;
  text-align: center;
  font-size: 12.5px;
}

.scene-meta {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid #c9dade;
  border-radius: 6px;
  background: rgb(255 255 255 / 90%);
  color: #31505a;
  font-size: 11.5px;
  font-weight: 650;
  pointer-events: none;
}

.scene-meta__dot { width: 6px; height: 6px; border-radius: 50%; background: #178596; }

.reset {
  position: absolute;
  right: 12px;
  bottom: 12px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: rgb(255 255 255 / 94%);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
</style>

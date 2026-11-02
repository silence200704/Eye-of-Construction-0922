<script setup lang="ts">
/**
 * 右侧楼层抽屉：贴场景右缘抽出，F1–Fn 竖排、当前层高亮。
 * 抽屉带左侧拉手，可向右拖回收起；不打开时留一个“楼层”拉片，点击即可抽出。
 * 非模态：打开时场景仍可旋转/平移，不做遮罩。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface FloorDrawerFloor {
  id: string
  floorNo: number
  name: string
  built: boolean
}

const props = defineProps<{
  open: boolean
  buildingCode: string
  buildingName: string
  floors: FloorDrawerFloor[]
  activeFloorId: string
}>()

const emit = defineEmits<{
  open: []
  close: []
  selectFloor: [floorId: string]
}>()

const panelRef = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
const ordered = computed(() => [...props.floors].sort((a, b) => b.floorNo - a.floorNo))
const hasFloors = computed(() => props.buildingCode !== '' && props.floors.length > 0)

const dragging = ref(false)
const dragX = ref(0)
let dragStart = 0

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

function startDrag(event: PointerEvent): void {
  if (!props.open) return
  event.preventDefault()
  dragging.value = true
  dragStart = event.clientX
  dragX.value = 0
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', endDrag, { once: true })
}

function onDragMove(event: PointerEvent): void {
  if (!dragging.value) return
  dragX.value = Math.max(0, Math.min(140, event.clientX - dragStart))
}

function endDrag(): void {
  window.removeEventListener('pointermove', onDragMove)
  dragging.value = false
  if (dragX.value > 42) emit('close')
  dragX.value = 0
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      panelRef.value?.focus()
      return
    }
    document.removeEventListener('keydown', onKeydown)
    dragging.value = false
    dragX.value = 0
    if (previousFocus !== null && document.contains(previousFocus)) previousFocus.focus()
    previousFocus = null
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', onDragMove)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="hasFloors" class="floor-drawer-root" :class="{ 'floor-drawer-root--open': open }">
      <button
        v-if="!open"
        type="button"
        class="floor-pull-tab"
        aria-label="抽出楼层抽屉"
        @click="emit('open')"
      >
        <span class="pull-arrow">‹</span>
        <span>楼层</span>
      </button>

      <aside
        ref="panelRef"
        class="floor-rail"
        :class="{ 'floor-rail--open': open, 'floor-rail--dragging': dragging }"
        :style="{ transform: open ? `translate(${dragX}px, -50%)` : 'translate(122%, -50%)' }"
        role="navigation"
        aria-label="楼层抽屉"
        :aria-hidden="!open"
        :inert="!open"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <div
          class="rail-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动收起楼层抽屉"
          @pointerdown="startDrag"
        >
          <i /><i /><i />
        </div>
        <header class="rail-head">
          <strong>{{ buildingCode }}</strong>
          <button type="button" class="rail-close" aria-label="收起楼层抽屉" @click="emit('close')">收起</button>
        </header>
        <p class="rail-name">{{ buildingName }}</p>
        <div class="rail-list">
          <button
            v-for="row in ordered"
            :key="row.id"
            type="button"
            class="floor-btn"
            :class="{ 'floor-btn--on': row.id === activeFloorId, 'floor-btn--off': !row.built }"
            :disabled="!row.built"
            :aria-current="row.id === activeFloorId ? 'true' : undefined"
            @click="emit('selectFloor', row.id)"
          >
            <span class="floor-no">F{{ row.floorNo }}</span>
            <span class="floor-label">{{ row.built ? row.name : '未建档' }}</span>
          </button>
        </div>
        <button type="button" class="rail-collapse" aria-label="收起楼层抽屉" @click="emit('close')">⌄</button>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.floor-drawer-root { position: fixed; inset: 0; pointer-events: none; z-index: 55; }
.floor-pull-tab {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  width: 30px; padding: 12px 5px; border: 1px solid rgb(133 196 193 / 55%);
  border-right: 0; border-radius: 8px 0 0 8px;
  background: rgb(13 43 50 / 92%); color: #d8efec; font: inherit; font-size: 11px;
  cursor: pointer; pointer-events: auto; box-shadow: -6px 8px 22px rgb(4 28 33 / 18%);
}
.floor-pull-tab:hover { background: rgb(20 66 75 / 96%); color: #fff2cf; }
.pull-arrow { color: #e2b45d; font-size: 16px; line-height: 1; }
.floor-rail {
  position: fixed; right: 0; top: 50%;
  width: 130px; max-height: min(72vh, 620px);
  display: flex; flex-direction: column; padding: 8px 7px 7px 12px;
  color: #eaf5f2; background: rgb(13 43 50 / 92%);
  border: 1px solid rgb(133 196 193 / 45%); border-right: 0;
  border-radius: 9px 0 0 9px; box-shadow: 0 14px 34px rgb(4 28 33 / 28%);
  backdrop-filter: blur(8px); pointer-events: auto;
  transition: transform .22s cubic-bezier(.22,.8,.28,1);
  animation: rail-in .18s ease;
}
.floor-rail:focus { outline: 2px solid #e2b45d; outline-offset: 3px; }
.floor-rail--dragging { transition: none; cursor: grabbing; }
.rail-grip {
  position: absolute; left: 2px; top: 50%; transform: translateY(-50%);
  width: 8px; height: 44px; display: grid; align-content: center; gap: 3px;
  cursor: grab; touch-action: none;
}
.rail-grip i { display: block; width: 3px; height: 3px; border-radius: 50%; background: #7faaa8; }
.rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 4px; padding: 0 3px; }
.rail-head strong { font-size: 13px; letter-spacing: .04em; }
.rail-close {
  border: 0; background: none; color: #b7d6d3; font: inherit; font-size: 10px;
  cursor: pointer; padding: 2px 0;
}
.rail-name { margin: 2px 3px 7px; color: #8fbcba; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-list { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; scrollbar-width: thin; }
.floor-btn {
  display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 4px;
  width: 100%; min-height: 32px; padding: 4px 5px; border: 1px solid rgb(143 197 194 / 24%);
  border-radius: 5px; background: rgb(255 255 255 / 4%); color: #d7ebe8; font: inherit;
  text-align: left; cursor: pointer;
}
.floor-btn:hover { background: rgb(255 255 255 / 10%); }
.floor-btn--on { border-color: #e2b45d; background: rgb(226 180 93 / 18%); color: #fff2cf; }
.floor-btn--off { opacity: .48; cursor: not-allowed; }
.floor-no { color: #8fbcba; font-size: 10px; letter-spacing: .03em; }
.floor-btn--on .floor-no { color: #f0c76b; }
.floor-label { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-collapse {
  margin-top: 7px; height: 20px; border: 0; border-top: 1px solid rgb(143 197 194 / 20%);
  background: none; color: #8fbcba; font: inherit; font-size: 15px; line-height: 1; cursor: pointer;
}
@keyframes rail-in { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 720px) {
  .floor-rail { width: 112px; max-height: 62vh; }
  .floor-pull-tab { width: 28px; }
}
@media (prefers-reduced-motion: reduce) { .floor-rail { animation: none; transition: none; } }
</style>

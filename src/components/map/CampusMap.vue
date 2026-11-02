<script setup lang="ts">
/**
 * 校园平面图：楼栋标绘、点击定位、拖拽调整、滚轮缩放与指针平移。
 * 图上明确区分实测建档与示例数据。
 */
import { computed } from 'vue'
import type { Building, Footprint, NormPoint } from '@/types/domain'
import { VIEW_H, VIEW_W } from '@/core/map/viewport'
import { useMapInteraction } from '@/core/map/useMapInteraction'
import CampusBackdrop from './CampusBackdrop.vue'
import BuildingPlan from './BuildingPlan.vue'
import MapControls from './MapControls.vue'

const props = withDefaults(
  defineProps<{
    buildings: Building[]
    activeId?: string | null
    draft?: Footprint | null
    pickable?: boolean
    height?: number
    version?: number
    badges?: Record<string, number>
  }>(),
  { activeId: null, draft: null, pickable: false, height: 430, version: 1, badges: () => ({}) },
)

const emit = defineEmits<{
  select: [id: string]
  pick: [point: NormPoint]
  'update:draft': [footprint: Footprint]
}>()

const {
  svgRef,
  transform,
  panning,
  onWheel,
  reset,
  zoomButton,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDraftDown,
  onObjectDown,
} = useMapInteraction({
  pickable: () => props.pickable,
  hasDraft: () => props.draft !== null,
  onPick: (point) => emit('pick', point),
  onDraftMove: (point) => {
    if (props.draft !== null) emit('update:draft', { ...props.draft, x: point.x, y: point.y })
  },
})

interface Rect {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
}

function rectOf(footprint: Footprint): Rect {
  const width = footprint.w * VIEW_W
  const height = footprint.h * VIEW_H
  return {
    x: footprint.x * VIEW_W - width / 2,
    y: footprint.y * VIEW_H - height / 2,
    width,
    height,
    centerX: footprint.x * VIEW_W,
    centerY: footprint.y * VIEW_H,
  }
}

interface BuildingView {
  building: Building
  rect: Rect
}

const activeViews = computed<BuildingView[]>(() =>
  props.buildings
    .filter((row) => row.status === 'active')
    .map((building) => ({ building, rect: rectOf(building.footprint) })),
)

const archivedViews = computed<BuildingView[]>(() =>
  props.buildings
    .filter((row) => row.status === 'archived')
    .map((building) => ({ building, rect: rectOf(building.footprint) })),
)

const draftRect = computed(() => (props.draft === null ? null : rectOf(props.draft)))

</script>

<template>
  <div class="map" :style="{ height: `${height}px` }">
    <svg
      ref="svgRef"
      class="sheet"
      :class="{ 'sheet--panning': panning }"
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      preserveAspectRatio="xMidYMid meet"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <g :transform="transform">
        <CampusBackdrop />

        <g v-for="view in archivedViews" :key="view.building.id" class="bld bld--archived">
          <rect
            :x="view.rect.x"
            :y="view.rect.y"
            :width="view.rect.width"
            :height="view.rect.height"
            :transform="`rotate(${view.building.footprint.rotate} ${view.rect.centerX} ${view.rect.centerY})`"
            fill="#f0f2f3"
            stroke="#c6d1d6"
            stroke-width="1.4"
            stroke-dasharray="6 4"
            rx="3"
          />
          <text
            :x="view.rect.centerX"
            :y="view.rect.centerY + 4"
            text-anchor="middle"
            font-size="11"
            fill="#9fb3bb"
          >
            {{ view.building.code }} 已归档
          </text>
        </g>

        <g
          v-for="view in activeViews"
          :key="view.building.id"
          class="bld"
          @pointerdown="onObjectDown($event, () => emit('select', view.building.id))"
        >
          <g :transform="`rotate(${view.building.footprint.rotate} ${view.rect.centerX} ${view.rect.centerY})`">
            <rect
              :x="view.rect.x"
              :y="view.rect.y"
              :width="view.rect.width"
              :height="view.rect.height"
              rx="6"
              fill="transparent"
              pointer-events="all"
            />
            <BuildingPlan
              :building="view.building"
              :box="view.rect"
              :active="activeId === view.building.id"
            />
            <text
              :x="view.rect.centerX"
              :y="view.rect.centerY - 6"
              text-anchor="middle"
              font-size="13"
              font-weight="600"
              fill="#16232a"
              pointer-events="none"
            >
              {{ view.building.name }}
            </text>
            <text :x="view.rect.centerX" :y="view.rect.centerY + 11" text-anchor="middle" font-size="10.5" fill="#5a6b73" pointer-events="none">
              {{ view.building.code }}
              <tspan v-if="badges[view.building.id]"> · {{ badges[view.building.id] }} 个测点</tspan>
            </text>
          </g>
        </g>

        <g v-if="draft !== null && draftRect !== null" class="draft" @pointerdown="onDraftDown">
          <rect
            :x="draftRect.x"
            :y="draftRect.y"
            :width="draftRect.width"
            :height="draftRect.height"
            :transform="`rotate(${draft.rotate} ${draftRect.centerX} ${draftRect.centerY})`"
            fill="rgba(20,134,149,0.16)"
            stroke="#0b5762"
            stroke-width="2.4"
            stroke-dasharray="8 5"
            rx="3"
          />
          <text :x="draftRect.centerX" :y="draftRect.centerY + 4" text-anchor="middle" font-size="12" fill="#0b5762">
            楼栋占位（可拖拽调整）
          </text>
        </g>
      </g>

      <g class="title-block">
        <rect :x="VIEW_W - 322" :y="VIEW_H - 92" width="282" height="52" fill="#fbfcfc" stroke="#9fb3bb" stroke-width="1" />
        <text :x="VIEW_W - 312" :y="VIEW_H - 74" font-size="11" fill="#16232a" font-weight="600">
          图名：校园平面示意图
        </text>
        <text :x="VIEW_W - 312" :y="VIEW_H - 59" font-size="10" fill="#5a6b73">
          底图版本 v{{ version }}｜坐标约定：归一化 0–1
        </text>
        <text :x="VIEW_W - 312" :y="VIEW_H - 46" font-size="10" fill="#8b9aa1">数据来源：示例校区示意资料，非真实坐标</text>
      </g>
    </svg>

    <MapControls @zoom="zoomButton" @reset="reset" />

    <div class="legend">
      <span class="lg"><i class="swatch swatch--real" />实测建档</span>
      <span class="lg"><i class="swatch swatch--demo" />示例数据</span>
      <span class="lg"><i class="swatch swatch--arch" />已归档</span>
      <span v-if="pickable" class="lg lg--hint">点击空白处放置楼栋</span>
    </div>
  </div>
</template>

<style scoped>
.bld {
  cursor: pointer;
}

.bld--archived {
  cursor: default;
}

.swatch {
  display: inline-block;
  width: 12px;
  height: 10px;
  border: 1px solid transparent;
  border-radius: 2px;
}

.swatch--real {
  background: #d8ebee;
  border-color: #0f6e7c;
}

.swatch--demo {
  background: repeating-linear-gradient(45deg, #eef2f4 0 3px, #c3d0d6 3px 5px);
  border-color: #8fa3ac;
}

.swatch--arch {
  background: #f0f2f3;
  border-color: #c6d1d6;
  border-style: dashed;
}
</style>

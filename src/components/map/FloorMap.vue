<script setup lang="ts">
/**
 * 楼层平面示意图：按区域名称生成走廊与房间分隔，支持测点点击定位与新增落点。
 * 底图由程序生成，换真实楼层图时替换底图并递增底图版本，坐标约定不变。
 */
import { computed } from 'vue'
import type { Floor, NormPoint, Point, PointType } from '@/types/domain'
import { VIEW_H, VIEW_W } from '@/core/map/viewport'
import { useMapInteraction } from '@/core/map/useMapInteraction'
import MapControls from './MapControls.vue'

const props = withDefaults(
  defineProps<{
    floor: Floor | null
    points: Point[]
    levelLabel?: string
    activePointId?: string | null
    draftType?: PointType | null
    draftCoord?: NormPoint | null
    pickable?: boolean
    height?: number
  }>(),
  { levelLabel: '', activePointId: null, draftType: null, draftCoord: null, pickable: false, height: 430 },
)

const emit = defineEmits<{
  select: [id: string]
  pick: [point: NormPoint]
  'update:draft': [coord: NormPoint]
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
  hasDraft: () => props.draftCoord !== null,
  onPick: (point) => emit('pick', point),
  onDraftMove: (point) => emit('update:draft', point),
})

/** 平面几何（内容坐标 0~VIEW_W / 0~VIEW_H）：外轮廓 + 中间走廊 + 三列两排房间 */
const PLAN = { left: 90, right: 910, top: 110, bottom: 590, corridorTop: 300, corridorBottom: 400 }
const COLS = [90, 370, 640, 910]

interface Room {
  x: number
  y: number
  w: number
  h: number
  label: string
  stairs: boolean
}

const rooms = computed<Room[]>(() => {
  const zones = props.floor?.zones ?? []
  const label = (index: number) => zones[index] ?? `房间${index}`
  const list: Room[] = []
  for (let column = 0; column < 3; column += 1) {
    list.push({
      x: COLS[column],
      y: PLAN.top,
      w: COLS[column + 1] - COLS[column],
      h: PLAN.corridorTop - PLAN.top,
      label: label(column + 1),
      stairs: column === 1,
    })
  }
  for (let column = 0; column < 3; column += 1) {
    list.push({
      x: COLS[column],
      y: PLAN.corridorBottom,
      w: COLS[column + 1] - COLS[column],
      h: PLAN.bottom - PLAN.corridorBottom,
      label: label(column + 4),
      stairs: false,
    })
  }
  return list
})

const doors = computed(() =>
  rooms.value.map((room) => {
    const upper = room.y === PLAN.top
    return { cx: room.x + room.w / 2, y: upper ? PLAN.corridorTop : PLAN.corridorBottom, swing: upper ? -1 : 1 }
  }),
)

const TYPE_GLYPH: Record<PointType, { text: string; color: string }> = {
  crack: { text: '裂', color: '#0f6e7c' },
  tilt: { text: '倾', color: '#2f6f9e' },
  vibration: { text: '振', color: '#8a6210' },
  temp_humidity: { text: '温', color: '#1e7a54' },
  manual_check: { text: '检', color: '#5a6b73' },
}

interface PointView {
  point: Point
  x: number
  y: number
  glyph: { text: string; color: string }
}

const pointViews = computed<PointView[]>(() =>
  props.points.map((point) => ({
    point,
    x: point.coord.x * VIEW_W,
    y: point.coord.y * VIEW_H,
    glyph: TYPE_GLYPH[point.type],
  })),
)

const draftPos = computed(() => {
  if (props.draftCoord === null) return null
  return { x: props.draftCoord.x * VIEW_W, y: props.draftCoord.y * VIEW_H }
})

const draftGlyph = computed(() => (props.draftType === null ? null : TYPE_GLYPH[props.draftType]))

const realCount = computed(() => props.points.filter((row) => row.dataSource === 'real').length)
const demoCount = computed(() => props.points.filter((row) => row.dataSource === 'demo').length)

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
        <defs>
          <pattern id="fm-grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M50 0H0V50" fill="none" stroke="#eef2f3" stroke-width="1" />
          </pattern>
        </defs>

        <rect :width="VIEW_W" :height="VIEW_H" fill="#fbfcfc" />
        <rect :width="VIEW_W" :height="VIEW_H" fill="url(#fm-grid)" />

        <g v-if="floor !== null" class="plan">
          <rect
            :x="PLAN.left"
            :y="PLAN.top"
            :width="PLAN.right - PLAN.left"
            :height="PLAN.bottom - PLAN.top"
            fill="#f7fafb"
            stroke="#5a6b73"
            stroke-width="3"
            rx="2"
          />

          <template v-for="(room, index) in rooms" :key="`room-${index}`">
            <rect :x="room.x" :y="room.y" :width="room.w" :height="room.h" fill="#ffffff" stroke="#8fa3ac" stroke-width="1.6" />
            <text :x="room.x + room.w / 2" :y="room.y + 24" text-anchor="middle" font-size="12" fill="#5a6b73">
              {{ room.label }}
            </text>
            <g v-if="room.stairs" :stroke="'#a8b8bf'" stroke-width="1.2">
              <line
                v-for="tread in 6"
                :key="`t${tread}`"
                :x1="room.x + 24"
                :y1="room.y + 44 + tread * 12"
                :x2="room.x + room.w - 24"
                :y2="room.y + 44 + tread * 12"
              />
            </g>
          </template>

          <rect
            :x="PLAN.left"
            :y="PLAN.corridorTop"
            :width="PLAN.right - PLAN.left"
            :height="PLAN.corridorBottom - PLAN.corridorTop"
            fill="#eef5f7"
            stroke="#8fa3ac"
            stroke-width="1.6"
          />
          <text :x="PLAN.left + 30" :y="PLAN.corridorTop + 24" font-size="12" fill="#0f6e7c">
            {{ floor.zones[0] ?? '走廊' }}
          </text>
          <line
            :x1="PLAN.left + 120"
            :y1="(PLAN.corridorTop + PLAN.corridorBottom) / 2"
            :x2="PLAN.right - 40"
            :y2="(PLAN.corridorTop + PLAN.corridorBottom) / 2"
            stroke="#b6c5cc"
            stroke-width="1.4"
            stroke-dasharray="16 12"
          />

          <g v-for="(door, index) in doors" :key="`door-${index}`">
            <line :x1="door.cx - 22" :y1="door.y" :x2="door.cx + 22" :y2="door.y" stroke="#f7fafb" stroke-width="3.4" />
            <path
              :d="`M ${door.cx - 22} ${door.y} A 22 22 0 0 ${door.swing > 0 ? 1 : 0} ${door.cx} ${door.y + door.swing * 22}`"
              fill="none"
              stroke="#a8b8bf"
              stroke-width="1"
            />
          </g>

          <g class="dim">
            <line :x1="PLAN.left" :y1="PLAN.top - 40" :x2="PLAN.right" :y2="PLAN.top - 40" stroke="#9fb3bb" stroke-width="1" />
            <line :x1="PLAN.left" :y1="PLAN.top - 46" :x2="PLAN.left" :y2="PLAN.top - 34" stroke="#9fb3bb" stroke-width="1" />
            <line :x1="PLAN.right" :y1="PLAN.top - 46" :x2="PLAN.right" :y2="PLAN.top - 34" stroke="#9fb3bb" stroke-width="1" />
            <text :x="(PLAN.left + PLAN.right) / 2" :y="PLAN.top - 46" text-anchor="middle" font-size="10.5" fill="#8b9aa1">
              示意尺寸（非实测）
            </text>
          </g>
        </g>

        <g v-else>
          <text :x="VIEW_W / 2" :y="VIEW_H / 2" text-anchor="middle" font-size="13" fill="#8b9aa1">
            该楼栋尚未建立楼层，先在左侧添加楼层
          </text>
        </g>

        <g
          v-for="view in pointViews"
          :key="view.point.id"
          class="marker"
          :class="{ 'marker--archived': view.point.status === 'archived' }"
          @pointerdown="onObjectDown($event, () => emit('select', view.point.id))"
        >
          <circle
            v-if="activePointId === view.point.id"
            :cx="view.x"
            :cy="view.y"
            r="20"
            fill="none"
            stroke="#0b5762"
            stroke-width="2"
            stroke-dasharray="4 3"
          />
          <circle
            :cx="view.x"
            :cy="view.y"
            r="13"
            fill="#ffffff"
            :stroke="view.point.status === 'archived' ? '#c6d1d6' : view.glyph.color"
            :stroke-width="activePointId === view.point.id ? 3 : 2"
            :stroke-dasharray="view.point.dataSource === 'demo' ? '4 3' : undefined"
          />
          <text
            :x="view.x"
            :y="view.y + 4.5"
            text-anchor="middle"
            font-size="12"
            :fill="view.point.status === 'archived' ? '#9fb3bb' : view.glyph.color"
          >
            {{ view.glyph.text }}
          </text>
          <text :x="view.x" :y="view.y + 27" text-anchor="middle" font-size="10" fill="#5a6b73">
            {{ view.point.code }}
          </text>
        </g>

        <g v-if="draftPos !== null && draftGlyph !== null" class="draft" @pointerdown="onDraftDown">
          <circle :cx="draftPos.x" :cy="draftPos.y" r="17" fill="rgba(20,134,149,0.14)" stroke="#0b5762" stroke-width="2" stroke-dasharray="5 4" />
          <text :x="draftPos.x" :y="draftPos.y + 4.5" text-anchor="middle" font-size="12" fill="#0b5762">
            {{ draftGlyph.text }}
          </text>
          <text :x="draftPos.x" :y="draftPos.y + 31" text-anchor="middle" font-size="10" fill="#0b5762">新测点（可拖拽）</text>
        </g>
      </g>

      <g class="title-block">
        <rect :x="VIEW_W - 322" :y="VIEW_H - 92" width="282" height="52" fill="#fbfcfb" stroke="#9fb3bb" stroke-width="1" />
        <text :x="VIEW_W - 312" :y="VIEW_H - 74" font-size="11" fill="#16232a" font-weight="600">
          {{ levelLabel }} 楼层平面示意图
        </text>
        <text :x="VIEW_W - 312" :y="VIEW_H - 59" font-size="10" fill="#5a6b73">
          底图版本 v{{ floor?.planVersion ?? 1 }}｜测点 {{ points.length }} 个（实测 {{ realCount }} / 示例 {{ demoCount }}）
        </text>
        <text :x="VIEW_W - 312" :y="VIEW_H - 46" font-size="10" fill="#8b9aa1">底图为程序生成示意平面，非真实建筑图纸</text>
      </g>
    </svg>

    <MapControls @zoom="zoomButton" @reset="reset" />

    <div class="legend">
      <span class="lg"><i class="dot" style="border-color: #0f6e7c">裂</i>裂缝</span>
      <span class="lg"><i class="dot" style="border-color: #2f6f9e">倾</i>倾角</span>
      <span class="lg"><i class="dot" style="border-color: #8a6210">振</i>振动</span>
      <span class="lg"><i class="dot" style="border-color: #1e7a54">温</i>温湿度</span>
      <span class="lg"><i class="dot" style="border-color: #5a6b73">检</i>人工检查</span>
      <span v-if="pickable" class="lg lg--hint">点击楼层图放置测点</span>
    </div>
  </div>
</template>

<style scoped>
.marker {
  cursor: pointer;
}

.marker--archived {
  cursor: default;
}

.dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1.6px solid;
  border-radius: 50%;
  font-size: 9px;
  font-style: normal;
  background: #fff;
}
</style>

<script setup lang="ts">
/**
 * 2D 校园图里的建筑平面示意：用屋顶分缝、入口台阶与玻璃中庭把“矩形占位”画成一栋楼。
 * 只负责画法，不改变 footprint / 点击范围；真实/示例的虚实线由外层 group 控制。
 */
import { computed } from 'vue'
import type { Building } from '@/types/domain'

export interface PlanBox {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
}

const props = defineProps<{
  building: Building
  box: PlanBox
  active: boolean
}>()

interface Palette {
  base: string
  roof: string
  roofLine: string
  glass: string
  accent: string
  trim: string
}

const PALETTES: Record<string, Palette> = {
  B01: { base: '#e4dfd2', roof: '#a9c1cf', roofLine: '#6f8f9f', glass: '#6f98a7', accent: '#c7a466', trim: '#f4f1e9' },
  B02: { base: '#d9ddda', roof: '#a9bcc5', roofLine: '#718a95', glass: '#5e8795', accent: '#c7a466', trim: '#f1f2ef' },
  B03: { base: '#c4c8c6', roof: '#b9bfbd', roofLine: '#778481', glass: '#5c7d86', accent: '#f0eee8', trim: '#f2f0eb' },
  B04: { base: '#e0dbcf', roof: '#b4c0c2', roofLine: '#7d8f92', glass: '#557987', accent: '#c7a466', trim: '#f3f0e8' },
  B05: { base: '#d9d6cc', roof: '#cbc8bd', roofLine: '#8d9899', glass: '#78a3b2', accent: '#c7a466', trim: '#f1eee5' },
}
const DEFAULT: Palette = { base: '#e2e2da', roof: '#c9cec9', roofLine: '#8c9999', glass: '#7c99a2', accent: '#c7a466', trim: '#f2f0e9' }

const palette = computed(() => PALETTES[props.building.code] ?? DEFAULT)
const roof = computed(() => ({
  x: props.box.x + props.box.width * 0.045,
  y: props.box.y + props.box.height * 0.09,
  width: props.box.width * 0.91,
  height: props.box.height * 0.78,
}))
const outerStroke = computed(() => (props.active ? '#0b5762' : palette.value.roofLine))
const strokeWidth = computed(() => (props.active ? 2.6 : 1.6))
const dash = computed(() => (props.building.dataSource === 'real' ? undefined : '7 5'))
</script>

<template>
  <g class="bld-plan" :class="{ 'bld-plan--active': active }">
    <!-- 落影：让平面图在纸面上有一点厚度，不参与点击 -->
    <rect
      :x="box.x + 5"
      :y="box.y + 7"
      :width="box.width"
      :height="box.height"
      rx="7"
      fill="#1d3940"
      opacity="0.075"
      pointer-events="none"
    />
    <rect
      :x="box.x"
      :y="box.y"
      :width="box.width"
      :height="box.height"
      rx="6"
      :fill="palette.base"
      :stroke="outerStroke"
      :stroke-width="strokeWidth"
      :stroke-dasharray="dash"
      pointer-events="none"
    />
    <rect
      :x="roof.x"
      :y="roof.y"
      :width="roof.width"
      :height="roof.height"
      rx="3"
      :fill="palette.roof"
      :stroke="palette.roofLine"
      stroke-width="0.8"
      pointer-events="none"
    />

    <!-- 图书馆：双塔 + 凹入玻璃中庭 + 正面大台阶 -->
    <g v-if="building.code === 'B05'" pointer-events="none">
      <rect :x="roof.x + roof.width * 0.02" :y="roof.y + roof.height * 0.05" :width="roof.width * 0.2" :height="roof.height * 0.9"
            :fill="palette.trim" :stroke="palette.roofLine" stroke-width="0.7" />
      <rect :x="roof.x + roof.width * 0.78" :y="roof.y + roof.height * 0.05" :width="roof.width * 0.2" :height="roof.height * 0.9"
            :fill="palette.trim" :stroke="palette.roofLine" stroke-width="0.7" />
      <rect :x="roof.x + roof.width * 0.25" :y="roof.y + roof.height * 0.12" :width="roof.width * 0.5" :height="roof.height * 0.67"
            :fill="palette.glass" stroke="#5d8592" stroke-width="1" />
      <g stroke="#dce6e6" stroke-width="0.7" opacity="0.9">
        <line v-for="column in 5" :key="`lib-v-${column}`"
              :x1="roof.x + roof.width * (0.25 + column * 0.083)" :y1="roof.y + roof.height * 0.12"
              :x2="roof.x + roof.width * (0.25 + column * 0.083)" :y2="roof.y + roof.height * 0.79" />
        <line v-for="row in 4" :key="`lib-h-${row}`"
              :x1="roof.x + roof.width * 0.25" :y1="roof.y + roof.height * (0.12 + row * 0.134)"
              :x2="roof.x + roof.width * 0.75" :y2="roof.y + roof.height * (0.12 + row * 0.134)" />
      </g>
      <rect :x="roof.x + roof.width * 0.36" :y="roof.y + roof.height * 0.64" :width="roof.width * 0.28" :height="roof.height * 0.14"
            :fill="palette.accent" opacity="0.9" />
      <g :fill="palette.trim" stroke="#a9a18f" stroke-width="0.5">
        <rect v-for="step in 5" :key="`lib-step-${step}`"
              :x="roof.x + roof.width * (0.3 - step * 0.018)" :y="roof.y + roof.height * (0.83 + step * 0.025)"
              :width="roof.width * (0.4 + step * 0.036)" height="3.2" rx="0.8" />
      </g>
      <g stroke="#8e9a98" stroke-width="0.7">
        <line v-for="fin in 4" :key="`lib-fin-l-${fin}`"
              :x1="roof.x + roof.width * (0.055 + fin * 0.035)" :y1="roof.y + roof.height * 0.14"
              :x2="roof.x + roof.width * (0.055 + fin * 0.035)" :y2="roof.y + roof.height * 0.86" />
        <line v-for="fin in 4" :key="`lib-fin-r-${fin}`"
              :x1="roof.x + roof.width * (0.8 + fin * 0.035)" :y1="roof.y + roof.height * 0.14"
              :x2="roof.x + roof.width * (0.8 + fin * 0.035)" :y2="roof.y + roof.height * 0.86" />
      </g>
    </g>

    <!-- B01：蓝灰四坡顶 + 中央门廊 -->
    <g v-else-if="building.code === 'B01'" pointer-events="none">
      <path :d="`M ${roof.x + roof.width * 0.08} ${roof.y + roof.height * 0.2} L ${roof.x + roof.width * 0.5} ${roof.y + roof.height * 0.47} L ${roof.x + roof.width * 0.92} ${roof.y + roof.height * 0.2}`"
            fill="none" :stroke="palette.roofLine" stroke-width="1" />
      <path :d="`M ${roof.x + roof.width * 0.08} ${roof.y + roof.height * 0.8} L ${roof.x + roof.width * 0.5} ${roof.y + roof.height * 0.53} L ${roof.x + roof.width * 0.92} ${roof.y + roof.height * 0.8}`"
            fill="none" :stroke="palette.roofLine" stroke-width="1" />
      <rect :x="roof.x + roof.width * 0.44" :y="roof.y + roof.height * 0.36" :width="roof.width * 0.12" :height="roof.height * 0.28"
            :fill="palette.trim" :stroke="palette.roofLine" stroke-width="0.7" />
      <rect :x="roof.x + roof.width * 0.35" :y="roof.y + roof.height * 0.84" :width="roof.width * 0.3" :height="roof.height * 0.09"
            :fill="palette.glass" />
    </g>

    <!-- B02：左塔 + 玻璃竖塔 + 右翼 -->
    <g v-else-if="building.code === 'B02'" pointer-events="none">
      <rect :x="roof.x + roof.width * 0.02" :y="roof.y + roof.height * 0.08" :width="roof.width * 0.3" :height="roof.height * 0.84"
            :fill="palette.trim" :stroke="palette.roofLine" stroke-width="0.8" />
      <rect :x="roof.x + roof.width * 0.38" :y="roof.y + roof.height * 0.12" :width="roof.width * 0.18" :height="roof.height * 0.76"
            :fill="palette.glass" stroke="#6c919d" stroke-width="0.8" />
      <rect :x="roof.x + roof.width * 0.58" :y="roof.y + roof.height * 0.04" :width="roof.width * 0.4" :height="roof.height * 0.9"
            fill="none" :stroke="palette.roofLine" stroke-width="0.9" />
      <path :d="`M ${roof.x + roof.width * 0.58} ${roof.y + roof.height * 0.1} L ${roof.x + roof.width * 0.78} ${roof.y + roof.height * 0.48} L ${roof.x + roof.width * 0.98} ${roof.y + roof.height * 0.1}`"
            fill="none" :stroke="palette.roofLine" stroke-width="1" />
      <rect :x="roof.x + roof.width * 0.33" :y="roof.y + roof.height * 0.84" :width="roof.width * 0.18" :height="roof.height * 0.1"
            :fill="palette.glass" />
    </g>

    <!-- B03：平屋顶 + 竖向凹槽 + 外挂楼梯 -->
    <g v-else-if="building.code === 'B03'" pointer-events="none">
      <rect :x="roof.x + roof.width * 0.05" :y="roof.y + roof.height * 0.08" :width="roof.width * 0.9" :height="roof.height * 0.84"
            fill="none" :stroke="palette.trim" stroke-width="2.2" />
      <g :stroke="palette.roofLine" stroke-width="0.7" opacity="0.85">
        <line v-for="groove in 8" :key="`teach-groove-${groove}`"
              :x1="roof.x + roof.width * (0.12 + groove * 0.1)" :y1="roof.y + roof.height * 0.14"
              :x2="roof.x + roof.width * (0.12 + groove * 0.1)" :y2="roof.y + roof.height * 0.82" />
      </g>
      <path :d="`M ${roof.x + roof.width * 0.03} ${roof.y + roof.height * 0.18} l ${roof.width * 0.08} ${roof.height * 0.16} l -${roof.width * 0.08} ${roof.height * 0.16} l ${roof.width * 0.08} ${roof.height * 0.16}`"
            fill="none" stroke="#f4f2ec" stroke-width="2.4" />
      <rect :x="roof.x + roof.width * 0.88" :y="roof.y + roof.height * 0.25" :width="roof.width * 0.14" :height="roof.height * 0.45"
            fill="none" :stroke="palette.roofLine" stroke-width="0.8" />
    </g>

    <!-- B04：弧形金属屋面 + 高侧窗 -->
    <g v-else-if="building.code === 'B04'" pointer-events="none">
      <path :d="`M ${roof.x + roof.width * 0.06} ${roof.y + roof.height * 0.36} Q ${roof.x + roof.width * 0.5} ${roof.y + roof.height * 0.04} ${roof.x + roof.width * 0.94} ${roof.y + roof.height * 0.36}`"
            fill="none" :stroke="palette.roofLine" stroke-width="1.2" />
      <path :d="`M ${roof.x + roof.width * 0.06} ${roof.y + roof.height * 0.64} Q ${roof.x + roof.width * 0.5} ${roof.y + roof.height * 0.96} ${roof.x + roof.width * 0.94} ${roof.y + roof.height * 0.64}`"
            fill="none" :stroke="palette.roofLine" stroke-width="1.2" />
      <g :stroke="palette.trim" stroke-width="0.8" opacity="0.8">
        <line v-for="seam in 5" :key="`gym-seam-${seam}`"
              :x1="roof.x + roof.width * (0.15 + seam * 0.14)" :y1="roof.y + roof.height * 0.16"
              :x2="roof.x + roof.width * (0.15 + seam * 0.14)" :y2="roof.y + roof.height * 0.84" />
      </g>
      <rect :x="roof.x + roof.width * 0.18" :y="roof.y + roof.height * 0.76" :width="roof.width * 0.64" :height="roof.height * 0.1"
            :fill="palette.glass" />
    </g>

    <!-- 其他楼栋：通用四坡顶与入口 -->
    <g v-else pointer-events="none">
      <path :d="`M ${roof.x + roof.width * 0.08} ${roof.y + roof.height * 0.2} L ${roof.x + roof.width * 0.5} ${roof.y + roof.height * 0.46} L ${roof.x + roof.width * 0.92} ${roof.y + roof.height * 0.2}`"
            fill="none" :stroke="palette.roofLine" stroke-width="1" />
      <rect :x="roof.x + roof.width * 0.38" :y="roof.y + roof.height * 0.8" :width="roof.width * 0.24" :height="roof.height * 0.12"
            :fill="palette.glass" />
    </g>

    <line :x1="roof.x + roof.width * 0.18" :y1="roof.y + roof.height * 0.985"
          :x2="roof.x + roof.width * 0.82" :y2="roof.y + roof.height * 0.985"
          stroke="#7f918f" stroke-width="1" opacity="0.55" pointer-events="none" />
  </g>
</template>

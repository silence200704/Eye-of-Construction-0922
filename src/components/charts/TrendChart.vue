<script setup lang="ts">
/**
 * 单测点单指标趋势图（SVG 自绘）。
 *
 * 一条数据线 + 基准线（按版本分段）+ 三级阈值线 + 事件节点 + 修订标记。
 * 不同单位不共轴：由调用方按"单测点单指标"传入 series，双轴指标分图呈现。
 */
import { computed, ref, useId } from 'vue'
import type { TrendPoint, TrendSeries } from '@/core/chart/trend'
import { decimalsOf, niceTicks } from '@/core/chart/axis'
import { stateTone } from '@/core/rules'
import { fmtNumber } from '@/core/format'

const props = withDefaults(
  defineProps<{
    series: TrendSeries
    height?: number
    /** 是否显示已被修订替代的记录 */
    showSuperseded?: boolean
    activeRecordId?: string | null
  }>(),
  { height: 340, showSuperseded: true, activeRecordId: null },
)

const emit = defineEmits<{ select: [recordId: string] }>()

const PAD = { left: 62, right: 128, top: 22, bottom: 40 }
const W = 1000

const hoveredId = ref('')

const allPoints = computed(() => [
  ...props.series.points,
  ...(props.showSuperseded ? props.series.supersededPoints : []),
])

/** 图上有事件节点时才列对应图例 */
const hasEventPoints = computed(() => allPoints.value.some((row) => row.eventId !== null))

/** 纵轴范围：把阈值线一并纳入，否则阈值会被裁到图外。 */
const yDomain = computed<[number, number]>(() => {
  const values = [
    ...allPoints.value.map((row) => row.value),
    ...props.series.thresholdLines.map((row) => row.value),
    ...props.series.baselineSegments.map((row) => row.value),
  ]
  if (values.length === 0) return [0, 1]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min) * 0.15 || Math.max(Math.abs(max) * 0.1, 0.1)
  return [Math.max(0, min - pad), max + pad]
})

/**
 * 横轴范围：数据点 + 规则/基准分段的边界。
 * 只按数据点取值会把换版点甩到时间轴之外（阈值线画进图例列），
 * 带上分段边界后，横轴与所选时间范围一致，换版点也能在轴上对应。
 */
const xDomain = computed<[number, number]>(() => {
  const stamps = [
    ...allPoints.value.map((row) => row.t),
    ...props.series.ruleSegments.flatMap((segment) => [segment.fromT, segment.toT]),
    ...props.series.baselineSegments.flatMap((segment) => [segment.fromT, segment.toT]),
  ].filter((t) => Number.isFinite(t) && t > 0)
  if (stamps.length === 0) return [Date.now() - 86_400_000, Date.now()]
  const min = Math.min(...stamps)
  const max = Math.max(...stamps)
  if (min === max) return [min - 43_200_000, max + 43_200_000]
  const pad = (max - min) * 0.02
  return [min - pad, max + pad]
})

/** 绘图区裁剪：任何线都不得越过坐标区（越界会横穿右侧图例） */
const clipId = `trend-plot-${useId()}`

const plotW = W - PAD.left - PAD.right
const plotH = computed(() => props.height - PAD.top - PAD.bottom)

function x(t: number): number {
  const [a, b] = xDomain.value
  return PAD.left + ((t - a) / (b - a)) * plotW
}

function y(v: number): number {
  const [a, b] = yDomain.value
  return PAD.top + plotH.value - ((v - a) / (b - a)) * plotH.value
}

/**
 * 有效数据线：已替代记录不参与连线，避免把撤销的值连进有效曲线；
 * 间隔过大的时段单独成段，不画跨越大段空白的直线。
 */
const valuePaths = computed(() =>
  props.series.lineSegments
    .filter((segment) => segment.length > 1)
    .map((segment) =>
      segment.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(row.t).toFixed(1)} ${y(row.value).toFixed(1)}`).join(' '),
    ),
)

/** 已替代记录之间的连线用虚线单独画，表示这段值曾存在但已被修订。 */
const supersededPath = computed(() =>
  props.series.supersededPoints
    .map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(row.t).toFixed(1)} ${y(row.value).toFixed(1)}`)
    .join(' '),
)

/** 纵轴刻度取整齐步长，让阈值线落在刻度上；小数位取指标精度与步长的较大者。 */
const yAxis = computed(() => niceTicks(yDomain.value[0], yDomain.value[1], 5))
const yTickDigits = computed(() => Math.max(props.series.series.digits, decimalsOf(yAxis.value.step)))
const yTicks = computed(() => yAxis.value.values.map((value) => ({ value, y: y(value) })))

const xTicks = computed(() => {
  const [a, b] = xDomain.value
  const steps = 4
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = a + ((b - a) * index) / steps
    return { t, x: x(t) }
  })
})

function fmtTick(t: number): string {
  const date = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 数据点颜色与状态标签同一套语义色；恢复待确认用品牌青，与设计令牌一致。 */
const STATE_COLOR: Record<string, string> = {
  gray: '#8b9aa1',
  green: '#1e7a54',
  yellow: '#C9A227',
  orange: '#D9720A',
  red: '#C0362C',
  brand: '#0f6e7c',
}

function colorOf(point: TrendPoint): string {
  if (point.state === null) return STATE_COLOR.gray
  return STATE_COLOR[stateTone(point.state)] ?? STATE_COLOR.gray
}

const LEVEL_COLOR: Record<string, string> = { yellow: '#C9A227', orange: '#D9720A', red: '#C0362C' }

const LEVEL_TEXT: Record<string, string> = { yellow: '黄色关注', orange: '橙色排查', red: '红色紧急核查' }

const activePoint = computed(() => allPoints.value.find((row) => row.recordId === props.activeRecordId) ?? null)
const hoverPoint = computed(() => allPoints.value.find((row) => row.recordId === hoveredId.value) ?? null)

/** 提示框位置：靠近节点但不越出画布。 */
const tip = computed(() => {
  const point = hoverPoint.value ?? activePoint.value
  if (point === null) return null
  const boxW = 208
  const left = Math.min(Math.max(x(point.t) + 12, PAD.left), W - PAD.right - boxW + 120)
  return { point, left, top: Math.max(y(point.value) - 54, PAD.top) }
})

/**
 * 页脚口径说明按本测点在本时间范围内的判定口径给出：
 * 相对基准、绝对判定、两种口径都出现过、以及该范围没有适用规则四种情况。
 */
const modeNote = computed(() => {
  const mode = props.series.mode
  if (mode === 'none') return '该时间范围没有适用的启用规则，图上只显示记录'
  // 温湿度这类规则不设三级阈值，不该在页脚谈阈值线
  if (props.series.thresholds === null) return '该时间范围内适用的规则不设三级阈值线，图上只显示记录'
  if (mode === 'relative') return '阈值线 = 当时生效基准 + 当时生效规则阈值'
  if (mode === 'absolute') return '绝对判定指标：阈值按当时生效规则版本分段，不使用基准'
  return '该时间范围内两种口径都出现过，阈值线按版本分段绘制'
})

function onMarkerClick(point: TrendPoint): void {
  emit('select', point.recordId)
}
</script>

<template>
  <div class="chart-wrap">
    <svg :viewBox="`0 0 ${W} ${height}`" preserveAspectRatio="xMidYMid meet" class="chart">
      <defs>
        <clipPath :id="clipId">
          <rect :x="PAD.left" :y="PAD.top" :width="plotW" :height="plotH" />
        </clipPath>
      </defs>

      <!-- 纵轴刻度与网格 -->
      <g class="axis">
        <template v-for="tick in yTicks" :key="`y${tick.value}`">
          <line :x1="PAD.left" :y1="tick.y" :x2="W - PAD.right" :y2="tick.y" stroke="#eef2f3" stroke-width="1" />
          <text :x="PAD.left - 10" :y="tick.y + 4" text-anchor="end" font-size="11" fill="#8b9aa1">
            {{ fmtNumber(tick.value, yTickDigits) }}
          </text>
        </template>
        <template v-for="tick in xTicks" :key="`x${tick.t}`">
          <line :x1="tick.x" :y1="PAD.top" :x2="tick.x" :y2="PAD.top + plotH" stroke="#f2f5f6" stroke-width="1" />
          <text :x="tick.x" :y="height - PAD.bottom + 18" text-anchor="middle" font-size="10.5" fill="#8b9aa1">
            {{ fmtTick(tick.t) }}
          </text>
        </template>
      </g>

      <!-- 以下图元一律裁剪在绘图区内：越界会画进右侧图例列 -->
      <g :clip-path="`url(#${clipId})`">
        <!-- 三级阈值线：相对基准的指标随基准分段 -->
        <g class="thresholds">
          <line
            v-for="(line, index) in series.thresholdLines"
            :key="`t${index}`"
            :x1="x(line.fromT)"
            :y1="y(line.value)"
            :x2="x(line.toT)"
            :y2="y(line.value)"
            :stroke="LEVEL_COLOR[line.level]"
            stroke-width="1.4"
            stroke-dasharray="7 5"
            opacity="0.75"
          />
        </g>

        <!-- 基准线：按版本分段，换版处断点 -->
        <g class="baseline">
          <line
            v-for="(segment, index) in series.baselineSegments"
            :key="`b${index}`"
            :x1="x(segment.fromT)"
            :y1="y(segment.value)"
            :x2="x(segment.toT)"
            :y2="y(segment.value)"
            stroke="#0f6e7c"
            stroke-width="2"
          />
        </g>

        <!-- 已替代记录：灰色空心点与虚线 -->
        <g v-if="showSuperseded && series.supersededPoints.length > 0" class="superseded">
          <path v-if="series.supersededPoints.length > 1" :d="supersededPath" fill="none" stroke="#9fb3bb" stroke-width="1.4" stroke-dasharray="4 4" />
          <circle
            v-for="point in series.supersededPoints"
            :key="point.recordId"
            :cx="x(point.t)"
            :cy="y(point.value)"
            r="5"
            fill="#ffffff"
            stroke="#9fb3bb"
            stroke-width="1.6"
            stroke-dasharray="3 2"
            class="marker"
            @click="onMarkerClick(point)"
            @mouseenter="hoveredId = point.recordId"
            @mouseleave="hoveredId = ''"
          />
        </g>

        <!-- 有效数据线：按测量连续性分段 -->
        <path v-for="(d, index) in valuePaths" :key="`v${index}`" :d="d" fill="none" stroke="#16232a" stroke-width="2" />

        <!-- 数据点：颜色随数值分级，事件升级点加外环 -->
        <g class="points">
          <template v-for="point in series.points" :key="point.recordId">
            <circle
              v-if="point.eventId !== null"
              :cx="x(point.t)"
              :cy="y(point.value)"
              r="10"
              fill="none"
              :stroke="point.eventLevel === null ? '#8b9aa1' : LEVEL_COLOR[point.eventLevel]"
              stroke-width="1.6"
              :stroke-dasharray="point.upgraded ? undefined : '3 3'"
            />
            <circle
              :cx="x(point.t)"
              :cy="y(point.value)"
              :r="point.recordId === activeRecordId ? 6.5 : 5"
              :fill="colorOf(point)"
              class="marker"
              @click="onMarkerClick(point)"
              @mouseenter="hoveredId = point.recordId"
              @mouseleave="hoveredId = ''"
            />
            <text
              v-if="point.upgraded"
              :x="x(point.t)"
              :y="y(point.value) - 14"
              text-anchor="middle"
              font-size="10.5"
              :fill="LEVEL_COLOR[point.eventLevel ?? 'yellow']"
            >
              事件升级
            </text>
          </template>
        </g>

      </g>

      <!-- 图例 -->
      <g class="legend" :transform="`translate(${W - PAD.right + 14} ${PAD.top})`">
        <text font-size="11" fill="#5a6b73">图例</text>
        <line x1="0" y1="16" x2="22" y2="16" stroke="#16232a" stroke-width="2" />
        <text x="28" y="20" font-size="10.5" fill="#5a6b73">{{ series.series.label }}</text>
        <line v-if="series.baselineSegments.length > 0" x1="0" y1="36" x2="22" y2="36" stroke="#0f6e7c" stroke-width="2" />
        <text v-if="series.baselineSegments.length > 0" x="28" y="40" font-size="10.5" fill="#5a6b73">
          基准{{ series.baselineSegments.length > 1 ? `（${series.baselineSegments.length} 段）` : '' }}
        </text>
        <template v-if="series.thresholds !== null">
          <line x1="0" y1="56" x2="22" y2="56" stroke="#C9A227" stroke-width="1.4" stroke-dasharray="7 5" />
          <text x="28" y="60" font-size="10.5" fill="#5a6b73">黄色阈值</text>
          <line x1="0" y1="72" x2="22" y2="72" stroke="#D9720A" stroke-width="1.4" stroke-dasharray="7 5" />
          <text x="28" y="76" font-size="10.5" fill="#5a6b73">橙色阈值</text>
          <line x1="0" y1="88" x2="22" y2="88" stroke="#C0362C" stroke-width="1.4" stroke-dasharray="7 5" />
          <text x="28" y="92" font-size="10.5" fill="#5a6b73">红色阈值</text>
        </template>
        <template v-if="hasEventPoints">
          <circle cx="11" cy="108" r="8" fill="none" stroke="#D9720A" stroke-width="1.6" />
          <text x="28" y="112" font-size="10.5" fill="#5a6b73">事件节点</text>
        </template>
        <template v-if="showSuperseded && series.supersededPoints.length > 0">
          <circle cx="11" cy="130" r="5" fill="#fff" stroke="#9fb3bb" stroke-width="1.6" stroke-dasharray="3 2" />
          <text x="28" y="134" font-size="10.5" fill="#5a6b73">已被修订替代</text>
        </template>
      </g>

      <!-- 悬浮/选中提示 -->
      <g v-if="tip !== null" class="tip">
        <rect :x="tip.left" :y="tip.top" width="212" height="70" rx="4" fill="#ffffff" stroke="#c6d1d6" />
        <text :x="tip.left + 10" :y="tip.top + 18" font-size="11" fill="#16232a">
          {{ tip.point.recordNo }}｜{{ fmtNumber(tip.point.value, series.series.digits) }}{{ series.series.unit }}
        </text>
        <text :x="tip.left + 10" :y="tip.top + 34" font-size="10.5" fill="#5a6b73">
          {{ fmtTick(tip.point.t) }}｜基准 v{{ tip.point.baselineVersion ?? '无' }}
        </text>
        <text :x="tip.left + 10" :y="tip.top + 50" font-size="10.5" :fill="tip.point.eventId === null ? '#8b9aa1' : LEVEL_COLOR[tip.point.eventLevel ?? 'yellow']">
          {{ tip.point.eventId === null ? '未触发事件' : `${tip.point.eventNo}｜${LEVEL_TEXT[tip.point.eventLevel ?? 'yellow']}${tip.point.upgraded ? '（本次升级）' : ''}` }}
        </text>
        <text :x="tip.left + 10" :y="tip.top + 64" font-size="10.5" fill="#8b9aa1">
          {{ tip.point.revision > 0 ? `已修订 ${tip.point.revision} 次` : '未修订' }}
        </text>
      </g>
    </svg>

    <p class="footnote">
      {{ modeNote }}
      <template v-if="series.baselineSegments.length > 1">；基准已换版，图上按版本分段绘制</template>
      <template v-if="series.ruleVersions.length > 1">；规则已换版（{{ series.ruleVersions.join(' → ') }}），每条记录按采样时间取当时版本判定</template>
      <template v-if="series.mode === 'mixed'">；规则或基准换版处已分段显示</template>。
      单位为 {{ series.series.unit }}，不同单位的指标不共轴。
    </p>
  </div>
</template>

<style scoped>
.chart-wrap {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: #fbfcfc;
  padding: 6px 10px 10px;
}

.chart {
  display: block;
  width: 100%;
}

.marker {
  cursor: pointer;
}

.footnote {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.6;
}
</style>

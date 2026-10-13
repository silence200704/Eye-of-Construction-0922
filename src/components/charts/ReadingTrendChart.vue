<script setup lang="ts">
/**
 * 测点最近有效读数趋势 + 三级阈值线。
 *
 * 每个数据点带 pointId / eventId：点有事件标记的点 → 打开那条事件；点普通读数 → 打开该测点趋势页。
 * 阈值线来自规则分段（与判定、预警中心同一套口径），同一张图只画同一指标 —— 单位不同不混轴。
 */
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { LineSeriesOption } from 'echarts/charts'
import ChartPanel from './ChartPanel.vue'
import { LEVEL_COLORS, LEVEL_NAMES, PANEL_GRID, type PanelOption } from './echartsSetup'
import type { ChartDataPoint, ReadingTrendModel } from '@/core/chart/dashboard'
import { formatDateTime } from '@/core/time'
import { fmtNumber } from '@/core/format'

const props = defineProps<{ model: ReadingTrendModel; domain?: [number,number] }>()
const emit = defineEmits<{ selectPoint: [pointId: string]; selectEvent: [eventId: string] }>()

interface DatumMeta {
  value?: [number, number]
  pointId?: string
  eventId?: string | null
}

interface AxisParams {
  seriesName?: string
  data?: DatumMeta
  dataIndex?: number
}

function tooltipOf(params: unknown, model: ReadingTrendModel): string {
  const rows = Array.isArray(params) ? (params as AxisParams[]) : []
  const parts = rows.map((row) => {
    const stamp = row.data?.value?.[0]
    const value = row.data?.value?.[1]
    if (stamp === undefined || value === undefined) return ''
    const event = row.data?.eventId == null ? '' : '｜命中事件'
    return `${row.seriesName ?? ''}<br/>${formatDateTime(new Date(stamp).toISOString())}：${fmtNumber(value, model.digits)} ${model.unit}${event}`
  }).filter((row) => row !== '')
  return parts.length === 0 ? '暂无有效读数' : parts.join('<br/>')
}

const option = computed<PanelOption>(() => {
  const model = props.model
  const series: LineSeriesOption[] = model.lines.flatMap((line) => line.segments.map((segment, index) => ({
    id: `${line.pointId}#${index}`,
    name: `${line.pointCode}｜${line.name}`,
    type: 'line' as const,
    symbol: 'circle',
    emphasis: { focus: 'series' as const },
    lineStyle: { width: 2 },
    data: segment.map((row: ChartDataPoint) => ({
      value: [row.t, row.value] as [number, number],
      pointId: line.pointId,
      eventId: row.eventId,
      symbolSize: row.eventLevel === null ? 6 : 11,
      itemStyle: row.eventLevel === null ? undefined : { color: LEVEL_COLORS[row.eventLevel] },
    })),
  })))

  const first = series[0]
  if (first !== undefined && model.thresholds.length > 0) {
    first.markLine = {
      silent: true,
      symbol: 'none' as const,
      data: model.thresholds.map((row) => ({
        yAxis: row.value,
        lineStyle: { color: LEVEL_COLORS[row.level], type: 'dashed' as const, width: 1 },
        label: {
          formatter: `${LEVEL_NAMES[row.level]}线 ${row.value} ${model.unit}`,
          position: 'insideStartTop' as const,
          fontSize: 10,
          color: LEVEL_COLORS[row.level],
        },
      })),
    }
  }

  return {
    grid: { ...PANEL_GRID, top: 40 },
    tooltip: { trigger: 'axis', formatter: (params: unknown) => tooltipOf(params, model) },
    legend: { type: 'scroll', top: 0, textStyle: { fontSize: 11 } },
    xAxis: { type: 'time', min: props.domain?.[0], max: props.domain?.[1], axisLabel: { formatter: '{MM}-{dd} {HH}:{mm}', fontSize: 10, hideOverlap: true } },
    yAxis: { type: 'value', scale: true, name: model.unit, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    series,
  }
})

function onClick(params: unknown): void {
  const row = (Array.isArray(params) ? params[0] : params) as AxisParams | undefined
  const meta = row?.data
  if (meta?.eventId != null && meta.eventId !== '') {
    emit('selectEvent', meta.eventId)
    return
  }
  if (meta?.pointId !== undefined) emit('selectPoint', meta.pointId)
}

const hint = computed(() => {
  const model = props.model
  const extras: string[] = []
  if (model.excludedReadings > 0) extras.push(`已排除 ${model.excludedReadings} 条存疑或无效读数`)
  if (model.otherMetricPoints > 0) extras.push(`另有 ${model.otherMetricPoints} 个同范围测点属于其他指标（单位不同，未混画）`)
  return extras.join('；')
})

const thresholdHint = computed(() => {
  if (props.model.lines.length > 1) return '多测点叠加时不绘制单测点阈值线；选一个测点可看对应规则。'
  if (props.model.metric === 'vibration' && props.model.fieldKey === 'accelPeak') {
    return '振动预警按加速度有效值 RMS 判定，峰值曲线不标预警阈值。'
  }
  return props.model.thresholds.length > 0
    ? '虚线为规则三级线，以及相对基准判定下的“基准＋阈值”等效线。'
    : '此维度没有可绘制的三级阈值线。'
})
</script>

<template>
  <div class="wrap">
    <ChartPanel :empty="model.lines.length === 0 ? model.emptyText : ''" :hint="hint">
      <VChart class="chart" :option="option" :style="{ height: '280px' }" autoresize @click="onClick" />
    </ChartPanel>
    <p v-if="model.lines.length > 0" class="hint">
      当前维度：{{ model.metricName }} · {{ model.fieldLabel }}（{{ model.unit }}）｜测点 {{ model.lines.length }} 个｜
      {{ thresholdHint }}
      <span v-if="hint !== ''"> {{ hint }}。</span>
      点数据点可打开对应事件或测点。
    </p>
  </div>
</template>

<style scoped>
.wrap { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 6px; }
.chart { width: 100%; }
.hint { margin: 0; color: var(--text-3); font-size: 11.5px; line-height: 1.7; }
</style>

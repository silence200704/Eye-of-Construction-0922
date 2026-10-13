<script setup lang="ts">
/**
 * 近 7 日预警事件柱状图（按事件去重）。
 *
 * 柱子按"未关闭 / 已关闭"堆叠：总高是当天事件数，红色段是当前还没处置完的部分。
 * 当天没有事件就显示 0 —— 那是事实，不是补出来的数；点柱子打开那天最近的一条事件。
 */
import { computed } from 'vue'
import VChart from 'vue-echarts'
import ChartPanel from './ChartPanel.vue'
import { LEVEL_COLORS, PANEL_GRID, type PanelOption } from './echartsSetup'
import type { EventDayBar, EventHistoryModel } from '@/core/chart/dashboard'

const props = defineProps<{ model: EventHistoryModel }>()
const emit = defineEmits<{ selectEvent: [eventId: string] }>()

const CLOSED_COLOR = '#9fb0b5'

interface DayDatum {
  value: number
  eventId: string | null
  dayKey: string
}

function datumOf(row: EventDayBar, value: number): DayDatum {
  return { value, eventId: row.eventIds[0] ?? null, dayKey: row.key }
}

function tooltipOf(params: unknown, days: EventDayBar[]): string {
  const rows = Array.isArray(params) ? (params as { dataIndex?: number }[]) : []
  const index = rows[0]?.dataIndex
  if (index === undefined) return ''
  const day = days[index]
  if (day === undefined) return ''
  const head = `${day.key}：共 ${day.count} 条（未关闭 ${day.openCount} 条）`
  return day.count === 0 ? head : `${head}<br/>${day.eventNos.join('、')}`
}

function totalLabelOf(param: unknown, days: EventDayBar[]): string {
  const index = (param as { dataIndex?: number }).dataIndex
  const day = index === undefined ? undefined : days[index]
  return day === undefined || day.count === 0 ? '' : String(day.count)
}

const option = computed<PanelOption>(() => {
  const days = props.model.days
  return {
    grid: { ...PANEL_GRID, top: 36 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: unknown) => tooltipOf(params, days) },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    xAxis: { type: 'category', data: days.map((row) => row.label), axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 } },
    series: [
      {
        name: '未关闭',
        type: 'bar',
        stack: 'day',
        barMaxWidth: 34,
        itemStyle: { color: LEVEL_COLORS.red },
        data: days.map((row) => datumOf(row, row.openCount)),
      },
      {
        name: '已关闭',
        type: 'bar',
        stack: 'day',
        barMaxWidth: 34,
        itemStyle: { color: CLOSED_COLOR },
        data: days.map((row) => datumOf(row, row.count - row.openCount)),
        label: { show: true, position: 'top', fontSize: 10, formatter: (param: unknown) => totalLabelOf(param, days) },
      },
    ],
  }
})

function onClick(params: unknown): void {
  const row = (Array.isArray(params) ? params[0] : params) as { data?: DayDatum } | undefined
  const eventId = row?.data?.eventId ?? null
  if (eventId !== null) emit('selectEvent', eventId)
}
</script>

<template>
  <div class="wrap">
    <ChartPanel :empty="model.total === 0 ? model.emptyText : ''" :hint="model.total === 0 ? '当前筛选范围内近 7 日没有预警事件（每条事件只在生成日计一次）' : ''">
      <VChart class="chart" :option="option" :style="{ height: '240px' }" autoresize @click="onClick" />
    </ChartPanel>
    <p v-if="model.total > 0" class="hint">
      近 7 日共 {{ model.total }} 条事件，其中未关闭 {{ model.openTotal }} 条；按**事件**去重（证据条数与升级次数不重复计数）。
      <span v-if="model.outOfScope > 0">另有 {{ model.outOfScope }} 条事件的测点不在当前筛选范围内，未计入。</span>
      点柱子可打开那天最近的一条事件。
    </p>
  </div>
</template>

<style scoped>
.wrap { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 6px; }
.chart { width: 100%; }
.hint { margin: 0; color: var(--text-3); font-size: 11.5px; line-height: 1.7; }
</style>

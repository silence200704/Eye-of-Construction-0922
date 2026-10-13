<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import ChartPanel from '../ChartPanel.vue'
import { insightOption, type InsightKind } from './options'
import type { InsightModel } from '@/core/chart/insights'

const props = defineProps<{ kind: InsightKind; model: InsightModel }>()
const emit = defineEmits<{ select: [key: string] }>()
const option = computed(() => insightOption(props.kind, props.model))
function select(params: unknown): void {
  const key = (params as { data?: { key?: string } })?.data?.key
  if (key && props.model.rows.some(row => row.key === key && row.count > 0)) emit('select', key)
}
</script>

<template>
  <ChartPanel :empty="model.total === 0 ? model.empty : ''">
    <div class="plot" :aria-label="`${kind === 'coverage' ? '测点' : kind === 'alerts' ? '未关闭事件' : '工单'}合计${model.total}`">
      <VChart :option="option" class="chart" autoresize @click="select" />
      <div v-if="kind === 'coverage'" class="center"><b>{{ model.total }}</b><span>传感器测点</span></div>
    </div>
  </ChartPanel>
</template>

<style scoped>
.plot { position: relative; height: 220px; }
.chart { width: 100%; height: 100%; }
.center { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; }
.center b { font: 34px var(--font-mono); color: var(--text); }
.center span { font-size: 12px; color: var(--text-2); }
</style>

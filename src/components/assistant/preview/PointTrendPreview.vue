<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDateTime } from '@/core/time'
import type { AskPreview } from '@/assistant/types'

const props = defineProps<{ preview: Extract<AskPreview, { kind: 'point_trend' }> }>()
const replay = ref(0)
const all = computed(() => props.preview.samples.flat())
const latest = computed(() => all.value[all.value.length - 1])
const span = computed(() => {
  const times = all.value.map((row) => Date.parse(row.sampleTime))
  const values = all.value.map((row) => row.value)
  return { minT: Math.min(...times), maxT: Math.max(...times), minV: Math.min(...values), maxV: Math.max(...values) }
})
function xy(row: { sampleTime: string; value: number }): string {
  const { minT, maxT, minV, maxV } = span.value
  const x = 12 + (maxT === minT ? 0.5 : (Date.parse(row.sampleTime) - minT) / (maxT - minT)) * 296
  const y = 73 - (maxV === minV ? 0.5 : (row.value - minV) / (maxV - minV)) * 58
  return `${x.toFixed(1)},${y.toFixed(1)}`
}
const paths = computed(() => props.preview.samples.map((segment) => segment.map(xy).join(' ')))
</script>

<template>
  <figure class="preview" aria-label="按原采样时间绘制的历史趋势，20 秒动画演示">
    <figcaption>
      <span><b>最近有效读数趋势</b><small>{{ preview.label }} · {{ preview.pointCode }}</small></span>
      <strong v-if="latest">{{ latest.value.toFixed(preview.digits) }}<em>{{ preview.unit }}</em></strong>
    </figcaption>
    <svg viewBox="0 0 320 90" preserveAspectRatio="none" role="img" aria-label="历史有效记录趋势">
      <line x1="12" y1="73" x2="308" y2="73" class="axis" />
      <polyline v-for="(path, index) in paths" :key="`base-${index}`" :points="path" class="base" />
      <g :key="replay" class="tracing">
        <polyline v-for="(path, index) in paths" :key="index" :points="path" class="trace" />
      </g>
      <circle v-if="latest" :cx="xy(latest).split(',')[0]" :cy="xy(latest).split(',')[1]" r="3.5" class="dot" />
    </svg>
    <div class="foot"><span v-if="all.length > 1">{{ formatDateTime(all[0].sampleTime) }} → {{ formatDateTime(latest!.sampleTime) }}</span><span v-else>仅 1 条有效记录，暂无趋势</span><button v-if="all.length > 1" type="button" @click="replay += 1">重播 20 秒</button></div>
    <p>20 秒回放已存的 {{ all.length }} 条采样，沿用监测趋势的断线口径；最新模拟实时样本也只是本次载入时生成，不持续连接设备。</p>
  </figure>
</template>

<style scoped>
.preview { margin: 0; padding: 10px 11px; border: 1px solid var(--brand-200); border-radius: var(--r-md); background: var(--brand-050); }
figcaption, .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
figcaption span { display: grid; gap: 2px; }
figcaption b { color: var(--brand-700); font-size: 12px; }
figcaption small, .foot, p { color: var(--text-3); font-size: 10.5px; }
figcaption strong { color: var(--brand-700); font: 700 18px var(--font-mono); white-space: nowrap; }
figcaption em { margin-left: 3px; font-size: 11px; font-style: normal; }
svg { display: block; width: 100%; height: 94px; margin: 5px 0; }
.axis { stroke: var(--line-strong); stroke-width: 1; }
.base, .trace { fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
.base { stroke: var(--brand-200); }.trace { stroke: var(--brand-600); }
.tracing { animation: trace-in 20s linear both; }.dot { fill: var(--brand-700); }
@keyframes trace-in { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.foot button { border: 0; background: transparent; color: var(--brand-700); font: inherit; cursor: pointer; white-space: nowrap; }
p { margin: 5px 0 0; line-height: 1.4; }
@media (prefers-reduced-motion: reduce) { .tracing { animation: none; } }
</style>

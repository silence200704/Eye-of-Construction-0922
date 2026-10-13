<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { AssistantSnapshot } from '@/assistant/selectors'
import { buildSamplingCoverage, buildAlertComposition, buildOrderInventory } from '@/core/chart/insights'
import type { InsightKind } from '@/components/charts/insights/options'
import InsightChart from '@/components/charts/insights/InsightChart.vue'
import SectionCard from '@/components/ui/SectionCard.vue'

const props = defineProps<{ snapshot: AssistantSnapshot; pointIds: string[] }>()
const router = useRouter()
const selected = ref<Record<string, string>>({})
const boards = computed(() => [
  { key: 'coverage' as const, title: '有效采样覆盖', sub: '当前测点的最新有效读数', model: buildSamplingCoverage(props.snapshot, props.pointIds) },
  { key: 'alerts' as const, title: '预警类型与等级', sub: '未关闭事件 · 当前等级', model: buildAlertComposition(props.snapshot, props.pointIds) },
  { key: 'orders' as const, title: '工单状态分布', sub: '当前测点关联工单 · 实际状态', model: buildOrderInventory(props.snapshot, props.pointIds) },
])
watch(() => props.pointIds.join(','), () => { selected.value = {} })

function pick(kind: InsightKind, key: string): void {
  selected.value[kind] = selected.value[kind] === key ? '' : key
}
function open(kind: InsightKind, id: string): void {
  const target = kind === 'coverage' ? { path: '/trend', query: { point: id } }
    : kind === 'alerts' ? { path: '/alarms', query: { event: id } }
      : { path: '/issues', query: { workOrder: id } }
  void router.push(target)
}
</script>

<template>
  <section class="boards" aria-label="监测与处置概览">
    <SectionCard v-for="board in boards" :key="board.key" :title="board.title" :sub="board.sub">
      <InsightChart :kind="board.key" :model="board.model" @select="pick(board.key, $event)" />
      <div class="counts" :class="{ 'counts--compact': board.key === 'orders' }" :aria-label="`${board.title}分类明细`">
        <button v-for="row in board.model.rows" :key="row.key" type="button" :disabled="row.count === 0"
          :aria-expanded="selected[board.key] === row.key" @click="pick(board.key, row.key)">
          <span class="dot" :style="{ background: row.color }" /><span>{{ row.label }}</span><b>{{ row.count }}</b>
        </button>
      </div>
      <template v-for="row in board.model.rows" :key="row.key">
        <div v-if="selected[board.key] === row.key && row.targets.length > 0" class="details">
          <b>{{ row.label }} · {{ row.count }} {{ board.key === 'coverage' ? '个测点' : '条' }}</b>
          <button v-for="target in row.targets" :key="target.id" type="button" @click="open(board.key, target.id)">{{ target.label }} <span>查看 →</span></button>
        </div>
      </template>
      <p class="note">{{ board.model.note }}</p>
    </SectionCard>
  </section>
</template>

<style scoped>
.boards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
.counts { display: grid; gap: 5px; margin-top: 10px; }
.counts--compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.counts button { display: flex; align-items: center; gap: 7px; min-height: 34px; padding: 6px 9px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--paper); color: var(--text-2); text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
.counts b { margin-left: auto; font-family: var(--font-mono); color: var(--text); }
.counts button[aria-expanded=true], .counts button:hover:not(:disabled) { border-color: var(--brand-500); background: var(--brand-050); }
.counts button:disabled { cursor: default; }
.dot { width: 7px; height: 7px; flex: none; border-radius: 50%; }
.note { margin: 12px 0 0; color: var(--text-3); font-size: 11.5px; line-height: 1.7; }
.details { display: grid; gap: 6px; max-height: 240px; overflow: auto; margin-top: 10px; padding: 12px; border-radius: var(--r-sm); background: var(--canvas); font-size: 12px; }
.details button { padding: 8px 0; border: 0; border-bottom: 1px solid var(--line); background: none; font: inherit; color: var(--text); cursor: pointer; text-align: left; overflow-wrap: anywhere; }
.details button span { color: var(--brand-700); white-space: nowrap; }
@media (max-width: 1180px) { .boards { grid-template-columns: repeat(2, minmax(0, 1fr)); }.boards > :last-child { grid-column: 1 / -1; } }
@media (max-width: 650px) { .boards { grid-template-columns: minmax(0, 1fr); }.counts button, .details button { min-height: 44px; } }
@media (min-width: 1181px) and (max-width: 1350px) { .counts--compact { grid-template-columns: minmax(0, 1fr); } }
</style>

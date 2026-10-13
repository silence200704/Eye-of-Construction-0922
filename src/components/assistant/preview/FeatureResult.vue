<script setup lang="ts">
import { ref } from 'vue'
import type { AskPreview } from '@/assistant/types'
import { formatDateTime } from '@/core/time'
import ReadingTrendChart from '@/components/charts/ReadingTrendChart.vue'
import EventReplay from '@/components/demo/EventReplay.vue'
defineProps<{ preview: AskPreview }>()
const changedOnly = ref(false)
</script>
<template>
  <section class="feature-result">
    <template v-if="preview.kind === 'point_compare'">
      <p>{{ preview.range.label }} · {{ formatDateTime(new Date(preview.range.from).toISOString()) }} — {{ formatDateTime(new Date(preview.range.toExclusive-1).toISOString()) }}</p>
      <div v-for="card in preview.cards" :key="card.label"><b>{{ card.label }}</b><ReadingTrendChart :model="card.model" :domain="[preview.range.from,preview.range.toExclusive-1]" /></div>
    </template>
    <EventReplay v-else-if="preview.kind === 'event_replay'" :nodes="preview.nodes" :event-id="preview.eventId" />
    <template v-else-if="preview.kind === 'case_search'">
      <p>总匹配 {{ preview.total }} 条（排除当前案例）；展示 {{ preview.rows.length }} 条。</p>
      <article v-for="row in preview.rows" :key="row.issueId" class="case"><b>{{ row.issueNo }} · {{ row.complete ? '完整办结' : '未完整办结' }}</b>
        <p>匹配：{{ row.reasons.join('、') }}</p><p>措施：{{ row.measures }}</p><p>复查：{{ row.recheck }}</p>
        <p v-if="row.gaps.length">缺口：{{ row.gaps.join('；') }}</p>
        <RouterLink :to="row.eventId ? `/reports/event/${encodeURIComponent(row.eventId)}` : {path:'/issues',query:{issue:row.issueId}}">打开原案例</RouterLink>
      </article>
    </template>
    <template v-else-if="preview.kind === 'rule_simulate'">
      <p>{{ preview.range.label }} · {{ preview.rows.length }} 条记录 · 候选阈值未保存</p>
      <label><input v-model="changedOnly" type="checkbox" />只看等级变化的记录</label>
      <div class="table"><table><thead><tr><th>记录编号</th><th>原判定</th><th>候选判定</th><th>依据／排除原因</th></tr></thead><tbody>
        <tr v-for="row in preview.rows.filter(r => !changedOnly || r.changed)" :key="row.recordNo"><td>{{ row.recordNo }}</td><td>{{ row.original }}</td><td>{{ row.candidate }}</td><td>{{ row.reason }}</td></tr>
      </tbody></table></div>
      <p v-if="!preview.rows.length">范围内没有记录，可以扩大范围。</p>
    </template>
  </section>
</template>
<style scoped>
.feature-result { display:grid; gap:12px; font-size:12px; min-width:0; }.feature-result p { line-height:1.7; margin:6px 0; }.case { padding:12px; border:1px solid var(--line); border-radius:var(--r-sm); }.case a { color:var(--brand-700); }.table { overflow:auto; }table { width:100%; border-collapse:collapse; }th,td { padding:9px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }th { white-space:nowrap; }
</style>

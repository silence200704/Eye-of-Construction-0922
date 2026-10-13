<script setup lang="ts">
/**
 * 未关闭异常队列（只读展示）。
 *
 * 与预警中心、小瞳回答共用同一份事件口径：按等级从高到低、同级按最近触发时间排序，
 * 计数按事件 ID 去重（升级只改同一条事件）。点击一行回到**原受控工作台**的事件详情 ——
 * 处置动作仍在那里按其角色权限完成，看板不提供绕过入口。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { formatDateTime } from '@/core/time'
import { EVENT_STATUS_LABEL } from '@/types/events'
import { useDashboardSnapshot } from '@/components/dashboard/liveSnapshot'
import { bySeverity, findPoint, levelText, openEvents, supportingEvidence } from '@/assistant/selectors'
import { EVENT_COUNT_NOTE } from '@/components/dashboard/text'
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{ pointIds: string[] | null; limit?: number }>()
const router = useRouter()

const snapshot = useDashboardSnapshot()

const rows = computed(() => {
  const scoped = props.pointIds === null ? openEvents(snapshot.value.events) : openEvents(snapshot.value.events).filter((row) => props.pointIds?.includes(row.pointId) === true)
  const sorted = bySeverity(scoped)
  return (props.limit === undefined ? sorted : sorted.slice(0, props.limit)).map((event) => {
    const point = findPoint(snapshot.value, event.pointId)
    const evidence = supportingEvidence(event)
    return {
      id: event.id,
      eventNo: event.eventNo,
      level: event.level,
      status: EVENT_STATUS_LABEL[event.status],
      levelText: levelText(event.level),
      place: point === undefined ? '测点已不在档案' : `${point.code} ${point.name}`,
      lastTriggerAt: formatDateTime(event.lastTriggerAt),
      triggerText: `${event.lastTriggerValue}${event.unit}`,
      evidenceRef: evidence === null ? '无活跃证据' : evidence.recordNo,
    }
  })
})

const counts = computed(() => {
  const totals = { red: 0, orange: 0, yellow: 0 }
  for (const row of rows.value) totals[row.level] += 1
  return totals
})

function openEvent(id: string): void {
  void router.push({ path: '/alarms', query: { event: id } })
}
</script>

<template>
  <SectionCard
    title="未关闭异常队列"
    :sub="`红 ${counts.red}｜橙 ${counts.orange}｜黄 ${counts.yellow}；点击一行到预警中心按原权限处置`"
    marked
  >
    <EmptyState
      v-if="rows.length === 0"
      title="当前筛选下没有未关闭事件"
      sub="未关闭为 0 只表示当前没有待处置事件，不代表系统做过巡检或已排除风险"
    />
    <div v-else class="queue">
      <button v-for="row in rows" :key="row.id" type="button" class="item" @click="openEvent(row.id)">
        <StatusTag :tone="row.level" :text="row.eventNo" />
        <span class="level">{{ row.levelText }}</span>
        <span class="status">{{ row.status }}</span>
        <span class="place">{{ row.place }}</span>
        <span class="meta">最近触发 {{ row.lastTriggerAt }}｜{{ row.triggerText }}｜证据 {{ row.evidenceRef }}</span>
      </button>
    </div>
    <p class="field-hint">{{ EVENT_COUNT_NOTE }}</p>
  </SectionCard>
</template>

<style scoped>
.queue { display: grid; gap: 6px; }
.item {
  display: grid;
  grid-template-columns: minmax(140px, auto) 84px 76px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.item:hover { border-color: var(--brand-500); background: var(--brand-050); }
.level { font-size: 12px; }
.status { color: var(--text-2); font-size: 11.5px; }
.place { font-size: 12px; overflow-wrap: anywhere; }
.meta { grid-column: 1 / -1; color: var(--text-3); font-size: 11.5px; }
@media (max-width: 900px) {
  .item { grid-template-columns: 1fr; }
}
</style>

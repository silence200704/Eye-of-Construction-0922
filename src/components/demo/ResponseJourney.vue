<script setup lang="ts">
/** 现场处置引导只读真实事件、问题和工单，不自行推进状态。 */
import { computed } from 'vue'
import { responseStageOf } from '@/core/demo/liveResponse'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'

const props = defineProps<{ eventId: string }>()
const events = useEventsStore()
const issues = useIssueStore()
const orders = useWorkOrderStore()

const event = computed(() => events.byId(props.eventId))
const issue = computed(() => issues.issues.find((row) => row.eventId === props.eventId))
const order = computed(() => issue.value?.workOrderIds.map((id) => orders.byId(id)).find((row) => row !== undefined))
const stage = computed(() => responseStageOf({ event: event.value, issue: issue.value, order: order.value }))
</script>

<template>
  <section v-if="event !== undefined" class="response-journey" aria-label="预警处置下一步">
    <div class="journey-head">
      <b>现场处置流程 · 第 {{ stage.step }}/7 步</b>
      <span>预警 → 问题 → 派工 → 维修 → 验收 → 复查 → 关闭</span>
    </div>
    <div class="journey-next">
      <strong>下一步：{{ stage.action }}</strong>
      <span>责任角色：{{ stage.owner }}</span>
    </div>
    <p>{{ stage.hint }}</p>
    <small v-if="issue !== undefined">关联问题 {{ issue.issueNo }}<template v-if="order !== undefined"> · 工单 {{ order.orderNo }}</template></small>
  </section>
</template>

<style scoped>
.response-journey { padding: 12px 14px; border: 1px solid var(--line-strong); border-left: 3px solid var(--st-red); border-radius: var(--r-md); background: var(--paper); }
.journey-head, .journey-next { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.journey-head span, .journey-next span, small { color: var(--text-3); font-size: 11.5px; }
.journey-next { margin-top: 8px; }
.journey-next strong { color: var(--st-red); font-size: 14px; }
p { margin: 6px 0 0; color: var(--text-2); font-size: 12px; }
small { display: block; margin-top: 6px; }
</style>

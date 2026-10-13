<script setup lang="ts">
import { useRouter } from 'vue-router'
import { scenarioMeta } from '@/config/demoScenarios'
import { useEventsStore } from '@/stores/events'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useTaskStore } from '@/stores/inspection/tasks'
import type { DemoScenarioResult } from '@/stores/writes/demo/support'
import type { AnchorRef } from '@/stores/demo/registry'
import AppButton from '@/components/ui/AppButton.vue'

defineProps<{ rows: DemoScenarioResult[]; chainLine: string }>()
const router = useRouter()
const events = useEventsStore()
const orders = useWorkOrderStore()
const tasks = useTaskStore()

function caseTarget(ref: AnchorRef): { label: string; path: string; query: Record<string, string> } | null {
  if (ref.kind === 'event') {
    const event = events.byId(ref.id)
    return event ? { label: `事件 ${event.eventNo}`, path: '/alarms', query: { event: event.id } } : null
  }
  if (ref.kind === 'workOrder') {
    const order = orders.byId(ref.id)
    return order ? { label: `工单 ${order.orderNo}`, path: '/issues', query: { workOrder: order.id } } : null
  }
  if (ref.kind === 'inspectionTask') {
    const task = tasks.tasks.find((row) => row.id === ref.id)
    return task ? { label: `巡检 ${task.taskNo}`, path: '/inspection', query: { task: task.id } } : null
  }
  return null
}

function preparedCases(rows: DemoScenarioResult[]) {
  return rows.filter((row) => row.key === 'coverage' && row.ok)
    .flatMap((row) => (row.anchorRefs ?? []).map(caseTarget))
    .filter((target) => target !== null)
}
</script>

<template>
  <div class="result">
    <div v-if="preparedCases(rows).length" class="cases" aria-label="已准备的手动演示案例">
      <b>已准备案例</b>
      <AppButton v-for="target in preparedCases(rows)" :key="target.label" size="sm" @click="router.push({ path: target.path, query: target.query })">{{ target.label }}</AppButton>
    </div>
    <p v-if="chainLine" class="chain">关联链核对：{{ chainLine }}。已关联不等于所有待办已结束，以各对象当前状态为准。</p>
    <details>
      <summary>查看本次导入明细 · {{ rows.length }} 个场景</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">场景</th><th scope="col">导入结果</th><th scope="col">新增 / 复用</th><th scope="col">打开</th></tr></thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <th scope="row">{{ scenarioMeta(row.key).title }}</th>
              <td><span :class="row.ok ? 'ok' : 'failed'">{{ row.ok ? '已准备' : '未完成' }}</span> · {{ row.message }}</td>
              <td class="count">{{ row.created }} / {{ row.skipped }}</td>
              <td><AppButton v-if="row.ok && row.focus" size="sm" @click="router.push(row.focus)">打开页面</AppButton><span v-else>—</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>

<style scoped>
.result { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 14px; }
.cases { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.chain { font-size: 12px; color: var(--text-2); line-height: 1.8; overflow-wrap: anywhere; }
summary { color: var(--brand-700); font-size: 13px; cursor: pointer; padding: 7px 0; }
.table-wrap { margin-top: 10px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
th, td { padding: 10px; border-bottom: 1px solid var(--line); vertical-align: top; line-height: 1.7; }
thead { background: var(--canvas); color: var(--text-2); }
tbody th { min-width: 105px; font-weight: 500; }
.count { white-space: nowrap; font-variant-numeric: tabular-nums; }
.ok { color: var(--brand-700); font-weight: 600; }
.failed { color: var(--st-red); font-weight: 600; }
</style>

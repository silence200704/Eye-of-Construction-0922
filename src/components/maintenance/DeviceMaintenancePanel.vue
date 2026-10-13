<script setup lang="ts">
/**
 * 设备一档的保养信息（只读）。
 *
 * 从保养仓储现算，不做缓存也不写库：没有计划就显示"暂无保养计划"，没有执行记录就显示"暂无保养记录"，
 * **不用空值或推算值冒充数据** —— 档案页说的每一句都要能在保养台账里对上。
 */
import { computed, ref } from 'vue'
import type { Device } from '@/types/domain'
import type { MaintenanceDataInput } from '@/core/maintenance/board'
import { maintenanceLedger, maintenanceRecordsOf, maintenanceTaskState, summarizeText } from '@/core/maintenance/board'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useClockStore } from '@/stores/clock'
import { formatDateTime } from '@/core/time'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const props = defineProps<{ device: Device }>()

const plans = useMaintenancePlanStore()
const tasks = useMaintenanceTaskStore()
const clock = useClockStore()

const historyOpen = ref(false)

const dataInput = computed<MaintenanceDataInput>(() => ({
  plans: plans.plans,
  tasks: tasks.tasks,
  devices: [props.device],
  todayKey: clock.todayKey,
  now: new Date(clock.nowKey),
}))

/** 台账同一套聚合：设备一档与台账页的口径必须一致，否则同一台设备两处显示对不上 */
const row = computed(() => maintenanceLedger(dataInput.value)[0] ?? null)
const records = computed(() => maintenanceRecordsOf(tasks.tasks, props.device.id))

const cycleText = computed(() => {
  const plan = row.value?.plan
  if (plan === null || plan === undefined) return '—'
  const unit = plan.cycle.unit === 'day' ? '天' : plan.cycle.unit === 'week' ? '周' : '月'
  return `每 ${plan.cycle.interval} ${unit} ${plan.cycle.atTime}`
})

const nextDueText = computed(() => {
  const current = row.value
  if (current === null || current.nextDueDate === null) return '暂无下次保养日期'
  return current.nextDueSource === 'execution' ? `${current.nextDueDate}（最近一次执行登记）` : `${current.nextDueDate}（按周期推算）`
})

const lastText = computed(() => {
  const last = row.value?.lastResult ?? null
  if (last === null) return '暂无保养记录'
  return `${formatDateTime(last.at)}｜执行人 ${last.by}｜照片 ${last.photoCount} 张`
})

/** 执行记录的摘要行：措施为空时不留一个空荡荡的字段 */
function recordSummary(taskId: string): string {
  const task = records.value.find((item) => item.id === taskId)
  const execution = task?.execution ?? null
  if (execution === null) return '尚未执行'
  return `措施：${summarizeText(execution.measures, 30) || '（未填写）'}｜材料：${execution.materials || '无'}｜下次保养 ${execution.nextDueDate}`
}
</script>

<template>
  <div class="block">
    <div class="row-between head">
      <b>保养</b>
      <span class="muted">{{ records.length }} 条保养任务记录</span>
    </div>

    <div class="items">
      <div class="item">
        <span class="label">当前生效计划</span>
        <span v-if="row === null || row.plan === null" class="muted">暂无保养计划</span>
        <span v-else>
          {{ row.plan.code }}｜{{ row.plan.name }}｜负责人 {{ row.plan.owner || '待补充' }}｜{{ cycleText }}
          <StatusTag :tone="row.plan.enabled ? 'green' : 'gray'" :text="row.plan.enabled ? '启用中' : '已停用'" />
          <span v-if="row.planCount > 1" class="muted">（共 {{ row.planCount }} 个计划，其中启用 {{ row.activePlanCount }} 个）</span>
        </span>
      </div>
      <div class="item">
        <span class="label">下次保养日期</span>
        <span class="mono">{{ nextDueText }}</span>
      </div>
      <div class="item">
        <span class="label">最近一次保养结果</span>
        <span>{{ lastText }}</span>
      </div>
      <div v-if="row?.lastResult" class="item">
        <span class="label">措施摘要</span>
        <span>{{ summarizeText(row.lastResult.measures, 40) || '（未填写措施）' }}</span>
      </div>
      <div class="item">
        <span class="label">历史保养次数</span>
        <span class="num">{{ row?.doneCount ?? 0 }} 次<template v-if="(row?.pendingCount ?? 0) > 0">｜待执行 {{ row?.pendingCount }} 条</template></span>
      </div>
    </div>

    <div class="row">
      <AppButton size="sm" :disabled="records.length === 0" @click="historyOpen = !historyOpen">
        {{ historyOpen ? '收起历史保养记录' : `查看历史保养记录（${records.length}）` }}
      </AppButton>
      <span class="muted">记录、照片与下次保养日期都在「设备保养」页维护；这里是只读汇总</span>
    </div>

    <ul v-if="historyOpen" class="records">
      <li v-for="task in records" :key="task.id">
        <div class="row-between">
          <span class="mono">{{ task.taskNo }}｜计划执行时刻 {{ formatDateTime(task.plannedAt) }}</span>
          <StatusTag :tone="maintenanceTaskState(task, dataInput.todayKey, dataInput.now).tone" :text="maintenanceTaskState(task, dataInput.todayKey, dataInput.now).label" />
        </div>
        <div class="muted">
          <template v-if="task.execution !== null">
            实际执行 {{ formatDateTime(task.execution.at) }}｜{{ task.execution.by }}（{{ task.execution.byRole }}）｜照片 {{ task.execution.photos.length }} 张
          </template>
          <template v-else>该周期尚未执行</template>
        </div>
        <div>{{ recordSummary(task.id) }}</div>
      </li>
    </ul>

    <p v-if="records.length === 0" class="muted">暂无保养记录：设备保养页生成任务并执行后，这里会出现记录与照片张数。</p>
  </div>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--bg-2, #f6f8f8);
  border-top: 1px solid var(--line);
  font-size: 12.5px;
}

.head {
  gap: 10px;
  align-items: center;
}

.items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 20px;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.label {
  font-size: 11.5px;
  color: var(--text-3);
}

.records {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.records li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  font-size: 12px;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>

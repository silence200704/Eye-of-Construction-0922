<script setup lang="ts">
/**
 * 保养任务详情：快照要求、本次执行记录、时间线，以及未完成时的执行面板。
 *
 * 页面上的范围、负责人、检查项全部来自**任务快照**（生成当时的值），
 * 计划之后怎么改都不影响这条任务 —— 所以这里不读计划，只读任务本身。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useIssueStore } from '@/stores/inspection/issues'
import type { MaintenanceBoardInput } from '@/core/maintenance/board'
import { maintenanceTaskState } from '@/core/maintenance/board'
import type { MaintenanceTask } from '@/types/maintenance'
import { useArchiveStore } from '@/stores/archive'
import { formatDateTime } from '@/core/time'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import MaintenanceExecutePanel from './MaintenanceExecutePanel.vue'

const props = defineProps<{ input: MaintenanceBoardInput; task: MaintenanceTask }>()
const router = useRouter()
const issues = useIssueStore()
/**
 * 本次执行转出的问题（v7 的双向关联）：任务侧要能直接跳到那条问题，
 * 只显示"已转问题"四个字的话，评审时还要去问题池里翻。
 */
const linkedIssue = computed(() => {
  const issueId = props.task.execution === null ? null : props.task.execution.issueId
  return issueId === null || issueId === undefined ? undefined : issues.byId(issueId)
})
const emit = defineEmits<{ close: []; notify: [text: string, ok: boolean] }>()

const archive = useArchiveStore()

const snapshot = computed(() => props.task.snapshot)
const state = computed(() => maintenanceTaskState(props.task, props.input.todayKey, props.input.now))
const execution = computed(() => props.task.execution)
const abnormalRows = computed(() => (execution.value?.checklist ?? []).filter((row) => row.result === 'abnormal'))
const unitText = computed(() => {
  const unit = snapshot.value.cycle.unit
  return unit === 'day' ? '天' : unit === 'week' ? '周' : '月'
})
const deviceLabel = computed(() => `${snapshot.value.deviceCode} ${snapshot.value.deviceName}`.trim())
const locationText = computed(
  () =>
    `${archive.buildingName(snapshot.value.buildingId)} ${archive.floorById(snapshot.value.floorId)?.name ?? snapshot.value.floorId} ${snapshot.value.zoneId}`,
)

/** 执行面板的提示直接向上抛，由工作台统一显示一行结果（避免每层各显示一处、互相盖住） */
function onPanelNotify(text: string, ok: boolean): void {
  emit('notify', text, ok)
}
</script>

<template>
  <div class="detail">
    <div class="row-between head">
      <div class="title">
        <b>{{ snapshot.planName }}｜{{ task.taskNo }}</b>
        <span class="muted">
          {{ deviceLabel }}｜{{ locationText }}｜执行时刻 {{ formatDateTime(task.plannedAt) }}
        </span>
        <span class="muted">快照周期：每 {{ snapshot.cycle.interval }} {{ unitText }} {{ snapshot.cycle.atTime }}｜负责人 {{ snapshot.owner || '待补充' }}</span>
      </div>
      <div class="row">
        <StatusTag :tone="state.tone" :text="state.label" />
        <AppButton size="sm" @click="emit('close')">关闭</AppButton>
      </div>
    </div>

    <div class="snapshot">
      <span class="section">快照要求（{{ snapshot.checklist.length }} 项检查清单）</span>
      <ul class="items">
        <li v-for="item in snapshot.checklist" :key="item.key">
          <span class="mono">{{ item.required ? '必答' : '选答' }}</span>
          <span>{{ item.label }}</span>
        </li>
      </ul>
      <p v-if="snapshot.checklist.length === 0" class="muted">本任务快照里没有检查项，执行时没有依据，请补齐计划后重新生成任务。</p>
    </div>

    <div v-if="execution !== null" class="record">
      <span class="section">本次执行记录</span>
      <p class="muted">
        {{ formatDateTime(execution.at) }}｜{{ execution.by }}（{{ execution.byRole }}）｜照片 {{ execution.photos.length }} 张｜下次保养 {{ execution.nextDueDate }}
      </p>
      <p class="text">维护措施：{{ execution.measures }}</p>
      <p v-if="execution.materials !== ''" class="text">更换材料：{{ execution.materials }}</p>
      <p v-if="execution.abnormalNote !== undefined && execution.abnormalNote !== ''" class="text">
        异常描述：{{ execution.abnormalNote }}
      </p>
      <p v-if="execution.issueId !== undefined && execution.issueId !== null" class="text">
        已转问题：
        <span v-if="linkedIssue === undefined">{{ execution.issueId }}（问题档案已删除）</span>
        <span v-else>{{ linkedIssue.issueNo }}｜{{ linkedIssue.status === 'closed' ? '已关闭' : '处理中' }}</span>
        <AppButton size="sm" variant="ghost" @click="router.push(`/issues?issue=${execution.issueId}`)">打开问题</AppButton>
      </p>
      <p v-if="execution.note !== ''" class="text">备注：{{ execution.note }}</p>
      <ul class="items">
        <li v-for="row in execution.checklist" :key="row.key">
          <StatusTag :tone="row.result === 'abnormal' ? 'orange' : 'green'" :text="row.result === 'abnormal' ? '异常' : '正常'" />
          <span>{{ row.label }}</span>
          <span v-if="row.note !== ''" class="muted">{{ row.note }}</span>
        </li>
      </ul>
      <p v-if="abnormalRows.length > 0" class="notice notice--warn">
        本次有 {{ abnormalRows.length }} 项异常：处理方式已在提交时选定（留痕或转问题），可在问题池按来源「保养发现」查看转出的问题。
      </p>
    </div>

    <MaintenanceExecutePanel v-else :task="task" @notify="onPanelNotify" />

    <div class="timeline">
      <span class="section">时间线</span>
      <ul>
        <li v-for="(row, index) in task.timeline" :key="index">
          <span class="mono">{{ formatDateTime(row.at) }}</span>
          <span>{{ row.by }}（{{ row.byRole }}）</span>
          <b>{{ row.action }}</b>
          <span class="muted">{{ row.detail }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12.5px;
}

.head {
  gap: 10px;
  align-items: flex-start;
}

.title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
}

.snapshot,
.record,
.timeline {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.section {
  font-size: 12px;
  color: var(--text-2);
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.items li {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.text {
  margin: 0;
  line-height: 1.6;
}

.timeline ul {
  margin: 0;
  padding-left: 16px;
  font-size: 11.5px;
  line-height: 1.8;
}

.timeline li {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>

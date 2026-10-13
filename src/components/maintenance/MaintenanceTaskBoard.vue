<script setup lang="ts">
/**
 * 保养任务视图（工作台「任务」区）。
 *
 * 四个视图（今日待办 / 我的保养 / 全部待办 / 逾期）的过滤与条数全部来自 core/maintenance/board 的纯函数，
 * 徽标与列表同源 —— 点了"逾期 2"进去看到的就是那 2 条，不会出现"卡片 2 条、列表 3 条"。
 * 日历点某天进来时走 `day` 过滤：只按执行时刻的本地日匹配，不改任何任务状态。
 *
 * 当前视图由父页面持有（`v-model:view`）：分区卡片点"保养逾期"要能把这里切到逾期视图。
 */
import { computed, ref, watch } from 'vue'
import type { MaintenanceBoardInput, MaintenanceViewKey } from '@/core/maintenance/board'
import { maintenanceTaskState, maintenanceTasksOnDay, maintenanceViewBadges, maintenanceViewOf } from '@/core/maintenance/board'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { formatDateTime } from '@/core/time'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import MaintenanceTaskDetail from './MaintenanceTaskDetail.vue'

const props = defineProps<{
  input: MaintenanceBoardInput
  day: string
  view: MaintenanceViewKey
  /** 深链要直接打开的那条任务（来自问题详情的「来源保养任务」跳转） */
  focusTaskId?: string
}>()
const emit = defineEmits<{ 'update:view': [key: MaintenanceViewKey]; clearDay: []; notify: [text: string, ok: boolean] }>()

const tasks = useMaintenanceTaskStore()

const openTaskId = ref('')

/*
 * 深链进来时直接展开那条任务：问题详情点「打开保养任务」后停在列表顶端，
 * 还要人自己再找一遍，等于没跳。
 */
watch(
  () => props.focusTaskId,
  (value) => {
    if (value !== undefined && value !== '' && tasks.byId(value) !== undefined) openTaskId.value = value
  },
  { immediate: true },
)

const badges = computed(() => maintenanceViewBadges(props.input))
const result = computed(() => maintenanceViewOf(props.input, props.view))
/** 日历选了某天时以那天的任务为准；四个视图按钮仍可点，点即退出该天过滤 */
const rows = computed(() => (props.day === '' ? result.value.tasks : maintenanceTasksOnDay(props.input.tasks, props.day)))
const openTask = computed(() => (openTaskId.value === '' ? null : tasks.byId(openTaskId.value) ?? null))

function pickView(key: MaintenanceViewKey): void {
  emit('update:view', key)
  if (props.day !== '') emit('clearDay')
}

/** 执行面板的结果由页面统一显示一行，避免多层各显示一处互相盖住 */
function onNotify(text: string, ok: boolean): void {
  emit('notify', text, ok)
}
</script>

<template>
  <div class="board">
    <div class="views">
      <button
        v-for="badge in badges"
        :key="badge.key"
        type="button"
        class="view"
        :class="badge.key === view && day === '' ? 'view--on' : ''"
        :aria-pressed="badge.key === view && day === ''"
        @click="pickView(badge.key)"
      >
        <b>{{ badge.label }}</b>
        <span class="num">{{ badge.count }}</span>
        <em>{{ badge.sub }}</em>
      </button>
    </div>

    <EmptyState
      v-if="rows.length === 0"
      :title="day === '' ? `「${result.label}」下没有保养任务` : `${day} 没有保养任务`"
      :sub="
        day === ''
          ? '任务由计划按周期生成：计划启用中且当天命中周期时，点「生成今日任务」即可产生待办'
          : '该天若命中计划执行日但还没生成任务，需在当天点「生成今日任务」生成；本演示不为历史日期补生成'
      "
    />

    <div v-else class="cards">
      <div v-for="task in rows" :key="task.id" class="card" :class="{ 'card--overdue': maintenanceTaskState(task, input.todayKey, input.now).overdue }">
        <div class="row-between">
          <b class="mono">{{ task.taskNo }}</b>
          <StatusTag
            :tone="maintenanceTaskState(task, input.todayKey, input.now).tone"
            :text="maintenanceTaskState(task, input.todayKey, input.now).label"
          />
        </div>
        <div class="name">{{ task.snapshot.planName }}</div>
        <div class="muted">
          {{ task.snapshot.deviceCode }} {{ task.snapshot.deviceName }}｜负责人 {{ task.snapshot.owner || '待补充' }}
        </div>
        <div class="muted">执行时刻 {{ formatDateTime(task.plannedAt) }}｜检查项 {{ task.snapshot.checklist.length }} 条</div>
        <div class="row-between">
          <span class="muted">周期快照：每 {{ task.snapshot.cycle.interval }} {{ task.snapshot.cycle.unit === 'day' ? '天' : task.snapshot.cycle.unit === 'week' ? '周' : '月' }} {{ task.snapshot.cycle.atTime }}</span>
          <button class="link" type="button" @click="openTaskId = openTaskId === task.id ? '' : task.id">
            {{ openTaskId === task.id ? '收起' : task.status === 'done' ? '查看记录' : '执行保养' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="openTask !== null" class="detail-wrap">
      <MaintenanceTaskDetail :input="input" :task="openTask" @close="openTaskId = ''" @notify="onNotify" />
    </div>
  </div>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.views {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.view {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  cursor: pointer;
  text-align: left;
}

.view b {
  font-size: 12.5px;
  color: var(--text-1);
}

.view .num {
  font-size: 17px;
  font-weight: 600;
  color: var(--brand-700);
}

.view em {
  font-style: normal;
  font-size: 10.5px;
  color: var(--text-3);
}

.view--on {
  border-color: var(--brand-500);
  box-shadow: inset 0 0 0 1px var(--brand-500);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--brand-500);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--paper);
  font-size: 12px;
}

.card--overdue {
  border-left-color: var(--state-red, #c0362c);
}

.card .name {
  font-size: 13.5px;
  font-weight: 600;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}

.detail-wrap {
  border: 1px solid var(--brand-300, #9dc6cd);
  border-radius: var(--r-sm);
  padding: 14px;
  background: var(--paper);
}

.link {
  border: 0;
  background: none;
  color: var(--brand-700);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}
</style>

<script setup lang="ts">
/**
 * 保养日历：按月看计划执行日与任务状态（已完成 / 待执行 / 逾期）。
 *
 * 日期全部由"计划周期命中 + 已存在的任务"推出，**页面不新造任何日期**：
 * 命中计划但还没生成任务的那天标为「计划日」，让人一眼看出"该生成却还没生成"。
 * 点某天跳到工作台看那天的任务列表（不在这里改数据）。
 */
import { computed, ref } from 'vue'
import type { MaintenanceCalendarDay, MaintenanceCalendarState, MaintenanceDataInput } from '@/core/maintenance/board'
import { maintenanceCalendar } from '@/core/maintenance/board'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ input: MaintenanceDataInput }>()
const emit = defineEmits<{ select: [dayKey: string] }>()

const today = computed(() => props.input.todayKey)
const year = ref(Number(today.value.slice(0, 4)))
const month = ref(Number(today.value.slice(5, 7)))

/** 周一为第一列：现场排班按周一到周日看，比周日开头更符合习惯 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const STATE_TEXT: Record<MaintenanceCalendarState, string> = {
  none: '',
  planned: '计划日（未生成任务）',
  pending: '待执行',
  overdue: '逾期',
  done: '已完成',
}

const days = computed(() => maintenanceCalendar(props.input, year.value, month.value))
const leading = computed(() => (new Date(year.value, month.value - 1, 1).getDay() + 6) % 7)
const monthSummary = computed(() => ({
  planDays: days.value.filter((row) => row.plans.length > 0).length,
  taskCount: days.value.reduce((sum, row) => sum + row.tasks.length, 0),
  overdue: days.value.filter((row) => row.state === 'overdue').length,
  done: days.value.filter((row) => row.state === 'done').length,
}))

function stateTone(state: MaintenanceCalendarState): string {
  if (state === 'overdue') return 'day--overdue'
  if (state === 'done') return 'day--done'
  if (state === 'pending') return 'day--pending'
  if (state === 'planned') return 'day--planned'
  return ''
}

/** 格子里的两行小字：命中几个计划、有几种任务 */
function planLine(day: MaintenanceCalendarDay): string {
  if (day.plans.length === 0) return ''
  return day.plans.length === 1 ? day.plans[0].code : `计划 ${day.plans.length} 个`
}

function taskLine(day: MaintenanceCalendarDay): string {
  if (day.tasks.length === 0) return ''
  return `${STATE_TEXT[day.state]} ${day.tasks.length} 条`
}

function shift(delta: number): void {
  const next = new Date(year.value, month.value - 1 + delta, 1)
  year.value = next.getFullYear()
  month.value = next.getMonth() + 1
}

function backToToday(): void {
  year.value = Number(today.value.slice(0, 4))
  month.value = Number(today.value.slice(5, 7))
}
</script>

<template>
  <div class="calendar">
    <div class="row-between actions">
      <div class="row">
        <AppButton size="sm" @click="shift(-1)">上一月</AppButton>
        <b class="month">{{ year }} 年 {{ month }} 月</b>
        <AppButton size="sm" @click="shift(1)">下一月</AppButton>
        <AppButton size="sm" @click="backToToday">回到本月（{{ today }}）</AppButton>
      </div>
      <span class="muted">
        本月命中计划执行日 {{ monthSummary.planDays }} 天｜任务 {{ monthSummary.taskCount }} 条｜逾期 {{ monthSummary.overdue }} 天｜已完成 {{ monthSummary.done }} 天
      </span>
    </div>

    <div class="legend">
      <span class="chip chip--planned">计划日（未生成任务）</span>
      <span class="chip chip--pending">待执行</span>
      <span class="chip chip--overdue">逾期</span>
      <span class="chip chip--done">已完成</span>
      <span class="muted">停用中的计划不再生成任务，因此不计入计划日；点某天可跳到工作台看那天的任务</span>
    </div>

    <div class="grid">
      <div v-for="label in WEEKDAYS" :key="label" class="weekday">{{ label }}</div>
      <div v-for="blank in leading" :key="`blank_${blank}`" class="day day--blank" />
      <button
        v-for="day in days"
        :key="day.dayKey"
        type="button"
        class="day"
        :class="[stateTone(day.state), day.dayKey === today ? 'day--today' : '']"
        @click="emit('select', day.dayKey)"
      >
        <span class="day-no">{{ Number(day.dayKey.slice(8, 10)) }}</span>
        <span v-if="planLine(day) !== ''" class="day-line">{{ planLine(day) }}</span>
        <span v-if="taskLine(day) !== ''" class="day-line day-line--task">{{ taskLine(day) }}</span>
      </button>
    </div>

    <p class="field-hint">
      图例只反映真实数据：没有命中计划、也没有任务的那天是空的；「计划日（未生成任务）」表示当天命中周期但还没生成任务，
      需要当天点「生成今日任务」生成（本演示不为历史日期补生成）。
    </p>
  </div>
</template>

<style scoped>
.calendar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.actions {
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.month {
  font-size: 14px;
  padding: 0 4px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
  font-size: 11.5px;
}

.chip {
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--line);
}

.chip--planned {
  background: var(--canvas);
  color: var(--text-2);
}

.chip--pending {
  background: var(--st-orange-bg);
  color: #8a4a04;
}

.chip--overdue {
  background: var(--st-red-bg);
  color: var(--st-red);
}

.chip--done {
  background: var(--brand-050);
  color: var(--brand-700);
}

.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.weekday {
  font-size: 11.5px;
  color: var(--text-3);
  text-align: center;
  padding-bottom: 2px;
}

.day {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 62px;
  padding: 6px 7px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  cursor: pointer;
  text-align: left;
  font-size: 11px;
  color: var(--text-2);
}

.day--blank {
  border: 0;
  background: transparent;
  cursor: default;
  min-height: 0;
}

.day-no {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.day-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-line--task {
  font-weight: 600;
}

.day--planned {
  border-color: var(--line-strong);
  background: var(--canvas);
}

.day--pending {
  border-color: #f0d9b5;
  background: var(--st-orange-bg);
}

.day--overdue {
  border-color: #e6b6b1;
  background: var(--st-red-bg);
}

.day--done {
  border-color: var(--brand-300, #9dc6cd);
  background: var(--brand-050);
}

.day--today {
  box-shadow: inset 0 0 0 1px var(--brand-600);
}
</style>

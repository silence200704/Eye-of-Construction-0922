<script setup lang="ts">
/**
 * 问题池列表（行呈现与复查标记）。
 *
 * 从 IssuePoolView 抽出来的原因：页面本身要管筛选、抽屉、未提交保护与上报入口，
 * 行内的状态色、复查到期标记、位置与任务编号的呈现是另一件事，混在一起两边都看不清。
 * 这里只做呈现与"点开详情"，筛选与选中状态由页面传入。
 */
import { computed } from 'vue'
import type { InspectionIssue } from '@/types/inspection'
import { ISSUE_SOURCES, ISSUE_STATUSES } from '@/types/inspection'
import { useArchiveStore } from '@/stores/archive'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useClockStore } from '@/stores/clock'
import { needsRecheck, recheckState } from '@/core/inspection/recheck'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const props = defineProps<{
  rows: InspectionIssue[]
  activeId: string
  highlightId: string
  /** 演示链的问题 id：来自演示场景，演示时要一眼认出来 */
  demoIds?: string[]
}>()
const emit = defineEmits<{ open: [id: string] }>()

/** 是不是演示链里的记录（用于重点标注）。 */
function isDemo(issue: InspectionIssue): boolean {
  return (props.demoIds ?? []).includes(issue.id)
}

const archive = useArchiveStore()
const tasks = useTaskStore()
const clock = useClockStore()
// 直接读共享刻度：跨天或手动刷新后，逾期标记会跟着变
const today = computed(() => clock.todayKey)

function sourceName(key: string): string {
  return ISSUE_SOURCES.find((row) => row.key === key)?.name ?? key
}

function statusName(key: string): string {
  return ISSUE_STATUSES.find((row) => row.key === key)?.name ?? key
}

function statusTone(issue: InspectionIssue): 'orange' | 'brand' | 'green' | 'gray' {
  if (issue.status === 'pending_review') return 'orange'
  if (issue.status === 'closed') return 'gray'
  if (issue.status === 'pending_recheck') return 'green'
  return 'brand'
}

function locationOf(issue: InspectionIssue): string {
  const floor = archive.floorById(issue.floorId)?.name ?? issue.floorId
  return `${archive.buildingName(issue.buildingId)} ${floor} ${issue.zoneId}`
}

function taskLabelOf(issue: InspectionIssue): string {
  if (issue.taskId === null) return '—'
  return tasks.byId(issue.taskId)?.taskNo ?? '（任务已删除）'
}

/** 行内的复查标记：逾期给天数（红字），其余给目标日期或"未登记"，不靠颜色单独表意。 */
function recheckBadge(issue: InspectionIssue): string {
  const state = recheckState(issue, today.value)
  if (state.state === 'overdue') return ''
  if (state.state === 'due') return '今天复查'
  if (state.state === 'awaiting' && state.round !== undefined) return `复查 ${state.round.dueDate.slice(5)}`
  if (needsRecheck(issue)) return '未登记复查'
  return ''
}
</script>

<template>
  <DataTable
    :columns="[
      { key: 'no', label: '问题编号', width: '168px' },
      { key: 'source', label: '来源', width: '96px' },
      { key: 'place', label: '位置' },
      { key: 'type', label: '异常类型', width: '110px' },
      { key: 'task', label: '关联任务', width: '150px' },
      { key: 'status', label: '状态', width: '118px' },
      { key: 'act', label: '操作', width: '78px' },
    ]"
    :row-count="rows.length"
    empty="当前筛选条件下没有问题"
  >
    <tr
      v-for="row in rows"
      :key="row.id"
      :class="{ 'row--active': activeId === row.id, 'row--flash': highlightId === row.id, 'row--demo': isDemo(row) }"
    >
      <td class="mono">
        <span v-if="isDemo(row)" class="demo-badge">演示链</span>{{ row.issueNo }}
      </td>
      <td>{{ sourceName(row.source) }}</td>
      <td>
        {{ locationOf(row) }}
        <div class="muted">{{ row.description.slice(0, 40) }}</div>
      </td>
      <td>{{ row.anomalyType }}</td>
      <td class="mono">{{ taskLabelOf(row) }}</td>
      <td>
        <StatusTag :tone="statusTone(row)" :text="statusName(row.status)" />
        <div v-if="recheckState(row, today).state === 'overdue'" class="recheck-late">
          复查逾期 {{ recheckState(row, today).overdueDays }} 天
        </div>
        <div v-else-if="recheckBadge(row) !== ''" class="recheck-note">{{ recheckBadge(row) }}</div>
      </td>
      <td>
        <button class="link" type="button" @click="emit('open', row.id)">
          {{ activeId === row.id ? '收起' : '详情' }}
        </button>
      </td>
    </tr>
  </DataTable>
</template>

<style scoped>
/* 复查标记：逾期用红色文字 + 天数，其余用灰字 */
.recheck-late {
  margin-top: 4px;
  font-size: 11px;
  color: var(--state-red, #c0362c);
}

.recheck-note {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-3);
}

/* 抽屉正看着的那一行 / 刚被定位的那一行 */
tr.row--active > td {
  background: var(--bg-2, #f6f8f8);
}

tr.row--flash > td {
  background: #fff3cd;
  transition: background 0.5s ease;
}

/* 演示链：左侧色条常驻，演示时不用翻找 */
tr.row--demo > td:first-child {
  box-shadow: inset 3px 0 0 var(--brand-500);
}

.demo-badge {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--brand-050);
  color: var(--brand-700);
  font-size: 10.5px;
  font-weight: 600;
  vertical-align: 1px;
}

.link {
  border: 0;
  background: none;
  color: var(--brand-700);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>

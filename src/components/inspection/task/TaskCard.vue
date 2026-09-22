<script setup lang="ts">
/**
 * 巡检任务卡。
 *
 * 状态只展示，不在这里改：任务状态由逐点检查结果推导（`taskStatusOf`），
 * 页面只能通过"逐点打卡"推进，避免出现"任务已完成但点位没查"的假完成。
 */
import { computed } from 'vue'
import type { InspectionTask } from '@/types/inspection'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useArchiveStore } from '@/stores/archive'
import { useTaskStore } from '@/stores/inspection/tasks'
import { formatDateTime } from '@/core/time'
import { ROLES } from '@/types/catalog'

/*
 * 注意：Vue 会把缺省的布尔 prop 转成 false，所以默认值必须显式声明，
 * 否则页面不传 showAction 时"开始检查"按钮会被 v-if 藏起来。
 */
const props = withDefaults(defineProps<{ task: InspectionTask; showAction?: boolean }>(), { showAction: true })
const emit = defineEmits<{ open: [taskId: string] }>()

const archive = useArchiveStore()
const tasks = useTaskStore()

const snapshot = computed(() => props.task.planSnapshot)
const progress = computed(() => tasks.progressOf(props.task))
/** 楼栋名也以快照为准；快照里的楼栋若已归档，退回显示编号以免空白 */
const label = computed(() => archive.buildingName(snapshot.value.buildingId) || snapshot.value.buildingId)
const statusMeta = computed(() => {
  if (props.task.status === 'checked') return { tone: 'green' as const, text: '已检查' }
  if (progress.value.overdue) return { tone: 'red' as const, text: '逾期未检' }
  if (props.task.status === 'partial') return { tone: 'orange' as const, text: '部分完成' }
  return { tone: 'gray' as const, text: '待检查' }
})
const roleName = computed(() => {
  const role = ROLES.find((row) => row.key === snapshot.value.executorRole)
  return role?.name ?? '未指定'
})

const pointCodes = computed(() =>
  props.task.results
    .map((row) => {
      const point = archive.pointById(row.pointId)
      return { code: point?.code ?? row.pointId, status: row.status }
    })
    .slice(0, 8),
)
</script>

<template>
  <div class="task-card">
    <div class="head">
      <div class="title">
        <b>{{ snapshot.planName }}</b>
        <span class="muted">{{ task.taskNo }}｜{{ label }}</span>
      </div>
      <StatusTag :tone="statusMeta.tone" :text="statusMeta.text" />
    </div>

    <dl class="meta">
      <div><dt>计划时刻</dt><dd class="num">{{ formatDateTime(task.plannedAt) }}</dd></div>
      <div><dt>当日截止</dt><dd class="num">{{ formatDateTime(task.dueAt) }}</dd></div>
      <div><dt>到点进度</dt><dd class="num">{{ progress.completed }} / {{ progress.total }}</dd></div>
      <div><dt>执行角色 / 检查项</dt><dd>{{ roleName }}｜{{ snapshot.checklist.length }} 项</dd></div>
    </dl>

    <div class="points">
      <span
        v-for="row in pointCodes"
        :key="row.code"
        class="point-chip"
        :class="row.status === 'completed' ? 'point-chip--done' : row.status === 'arrived' ? 'point-chip--arrived' : ''"
      >
        {{ row.code }}{{ row.status === 'completed' ? ' 完成' : row.status === 'arrived' ? ' 已到点' : '' }}
      </span>
    </div>

    <div v-if="showAction !== false" class="foot">
      <AppButton size="sm" variant="primary" @click="emit('open', task.id)">
        {{ progress.completed === 0 ? '开始检查' : '继续检查' }}
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.task-card {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
  color: var(--text-1);
}

.title .muted {
  font-size: 11.5px;
  color: var(--text-3);
}

.meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  font-size: 11.5px;
}

.meta dt {
  color: var(--text-3);
}

.meta dd {
  margin: 2px 0 0;
  color: var(--text-1);
}

.points {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.point-chip {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 10px;
  border: 1px solid var(--line);
  color: var(--text-2);
  background: var(--bg-2, #f6f8f8);
}

.point-chip--done {
  border-color: #1e7a54;
  color: #1e7a54;
}

.point-chip--arrived {
  border-color: #d9720a;
  color: #d9720a;
}

.foot {
  display: flex;
  justify-content: flex-end;
}
</style>

<script setup lang="ts">
/**
 * 点检巡检工作台（V0.3）。
 *
 * 三个页签对应现场的三件事：定计划、看今天要做什么、看我要做什么。
 * 任务状态一律由逐点检查结果推导，页面不提供"直接标记完成"的入口（方案 §3）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import type { InspectionPlan } from '@/types/inspection'
import { PLAN_KINDS } from '@/types/inspection'
import { ROLES } from '@/types/catalog'
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PlanForm from '@/components/inspection/PlanForm.vue'
import TaskCard from '@/components/inspection/task/TaskCard.vue'
import TaskDetail from '@/components/inspection/task/TaskDetail.vue'

const archive = useArchiveStore()
const session = useSessionStore()
const plans = usePlanStore()
const tasks = useTaskStore()
const route = useRoute()

type TabKey = 'plans' | 'today' | 'mine'
const tab = ref<TabKey>('plans')
const editing = ref<InspectionPlan | null>(null)
const showForm = ref(false)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')

const openTaskId = ref('')
const openTask = computed(() => (openTaskId.value === '' ? null : tasks.byId(openTaskId.value) ?? null))

// 只在目标/加载状态/目标存在性变化时定位；刷新仓储不能重开人刚关闭的详情。
watch([
  () => route.query.task,
  () => tasks.loaded,
  () => tasks.byId(typeof route.query.task === 'string' ? route.query.task : '')?.id,
], ([id, loaded]) => {
  if (!loaded || typeof id !== 'string' || id === '') return
  const task = tasks.byId(id)
  if (task === undefined) {
    openTaskId.value = ''
    notify('深链中的巡检任务不存在，请重新选择任务。', false)
    return
  }
  tab.value = 'today'
  openTaskId.value = task.id
}, { immediate: true })

function openTaskDetail(taskId: string): void {
  openTaskId.value = taskId
}

const TABS: { key: TabKey; label: string; sub: string }[] = [
  { key: 'plans', label: '巡检计划', sub: '定周期与必查点' },
  { key: 'today', label: '今日待办', sub: '按计划时刻生成' },
  { key: 'mine', label: '我的任务', sub: '按执行角色过滤' },
]

const myTasks = computed(() => tasks.tasksForRole(session.role))

/** 各执行角色的任务数：换身份前先知道任务在谁手上，避免"我的任务空着"像是坏了。 */
const roleSummaryText = computed(() =>
  ROLES.map((role) => ({ role, count: tasks.tasksForRole(role.key).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.role.name} ${item.count} 条`)
    .join('｜'),
)
const todaySummary = computed(() => {
  const rows = tasks.todayTasks
  const done = rows.filter((row) => row.status === 'checked').length
  const overdue = rows.filter((row) => tasks.progressOf(row).overdue).length
  return { total: rows.length, done, overdue }
})

function notify(text: string, ok = true): void {
  tone.value = ok ? 'ok' : 'bad'
  message.value = text
}

function openCreate(): void {
  editing.value = null
  showForm.value = true
  message.value = ''
}

function openEdit(plan: InspectionPlan): void {
  editing.value = plan
  showForm.value = true
  message.value = ''
}

async function savePlan(draft: Parameters<typeof plans.savePlan>[1]): Promise<void> {
  try {
    const row = await plans.savePlan(editing.value?.id ?? null, draft)
    showForm.value = false
    editing.value = null
    notify(`已保存计划 ${row.code}｜必查点 ${row.pointIds.length} 个`)
  } catch (error) {
    notify(`保存失败：${(error as Error).message}`, false)
  }
}

async function togglePlan(plan: InspectionPlan): Promise<void> {
  await plans.setEnabled(plan.id, !plan.enabled)
  notify(`${plan.enabled ? '已停用' : '已启用'}计划 ${plan.code}${plan.enabled ? '（既有任务保留）' : ''}`)
}

async function generateToday(): Promise<void> {
  const result = await tasks.generateFor(new Date())
  notify(
    result.created.length === 0
      ? '今日任务已是最新：没有需要新增的任务（同一计划同一执行时刻不会重复建单）'
      : `已生成今日任务 ${result.created.length} 条`,
    result.created.length > 0,
  )
}

/**
 * 立即刷新待办与逾期状态。
 *
 * "今天有哪些任务""是否逾期"按当前时刻算，而 `Date.now()` 不是响应式的：
 * 页面放着不动（或跨了零点）这些数字不会自己变。这里给一个显式入口，
 * 而不是塞一个后台定时器 —— 演示时页面上不该出现说不清来源的自动变化。
 */
async function refreshState(): Promise<void> {
  await tasks.refreshNow()
  notify(`已按当前时刻刷新：今日任务 ${todaySummary.value.total} 条｜逾期未检 ${todaySummary.value.overdue} 条`)
}

function planKindName(key: InspectionPlan['kind']): string {
  return PLAN_KINDS.find((row) => row.key === key)?.name ?? key
}

function cycleText(plan: InspectionPlan): string {
  const unit = plan.cycle.unit === 'day' ? '天' : plan.cycle.unit === 'week' ? '周' : '月'
  return `每 ${plan.cycle.interval} ${unit} ${plan.cycle.atTime}`
}

onMounted(async () => {
  if (!plans.loaded) await plans.reload()
  if (!tasks.loaded) await tasks.reload()
})
</script>

<template>
  <div class="stack">
    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">
      {{ message }}
    </p>

    <SectionCard title="点检巡检" sub="计划 → 任务 → 到点检查；任务状态只由逐点结果推导" marked>
      <div class="tabs">
        <button
          v-for="item in TABS"
          :key="item.key"
          type="button"
          class="tab"
          :class="tab === item.key ? 'tab--active' : ''"
          @click="tab = item.key"
        >
          <b>{{ item.label }}</b>
          <span>{{ item.sub }}</span>
        </button>
      </div>

      <!-- 巡检计划 -->
      <template v-if="tab === 'plans'">
        <div class="row-between actions">
          <span class="muted">
            共 {{ plans.plans.length }} 个计划（启用中 {{ plans.activePlans.length }} 个）｜
            巡检按路线设必查点，点检按设备生成清单
          </span>
          <div class="row">
            <AppButton size="sm" @click="generateToday">生成今日任务</AppButton>
            <AppButton size="sm" variant="primary" @click="openCreate">新建计划</AppButton>
          </div>
        </div>

        <div v-if="showForm" class="form-wrap">
          <PlanForm :plan="editing" @save="savePlan" @cancel="showForm = false; editing = null" />
        </div>

        <DataTable
          :columns="[
            { key: 'code', label: '计划编号', width: '176px' },
            { key: 'name', label: '计划', width: '220px' },
            { key: 'type', label: '类型', width: '110px' },
            { key: 'cycle', label: '周期', width: '130px' },
            { key: 'points', label: '必查点', width: '86px' },
            { key: 'state', label: '状态', width: '90px' },
            { key: 'act', label: '操作' },
          ]"
          :row-count="plans.plans.length"
          empty="还没有巡检计划：先建一个计划，再用「生成今日任务」产生待办"
        >
          <tr v-for="plan in plans.plans" :key="plan.id">
            <td class="mono">{{ plan.code }}</td>
            <td>
              <b>{{ plan.name }}</b>
              <div class="muted">{{ archive.buildingName(plan.buildingId) }}｜{{ plan.owner || '负责人待补充' }}</div>
            </td>
            <td>{{ planKindName(plan.kind) }}</td>
            <td class="mono">{{ cycleText(plan) }}</td>
            <td class="num">{{ plan.pointIds.length }}</td>
            <td>
              <StatusTag :tone="plan.enabled ? 'green' : 'gray'" :text="plan.enabled ? '启用中' : '已停用'" />
            </td>
            <td>
              <div class="row">
                <button class="link" type="button" @click="openEdit(plan)">编辑</button>
                <button class="link" type="button" @click="togglePlan(plan)">
                  {{ plan.enabled ? '停用' : '启用' }}
                </button>
              </div>
            </td>
          </tr>
        </DataTable>
      </template>

      <!-- 今日待办 -->
      <template v-else-if="tab === 'today'">
        <div class="row-between actions">
          <span class="muted">
            今日任务 {{ todaySummary.total }} 条｜已检查 {{ todaySummary.done }} 条｜逾期未检 {{ todaySummary.overdue }} 条
          </span>
          <div class="row">
            <AppButton size="sm" @click="refreshState">刷新状态</AppButton>
            <AppButton size="sm" @click="generateToday">生成今日任务</AppButton>
          </div>
        </div>
        <EmptyState
          v-if="tasks.todayTasks.length === 0"
          title="今天没有待办任务"
          sub="按周期命中今天、且计划处于启用中时才会生成任务；也可以点「生成今日任务」手动补一次"
        />
        <div v-else class="cards">
          <TaskCard v-for="task in tasks.todayTasks" :key="task.id" :task="task" @open="openTaskDetail" />
        </div>
        <div v-if="openTask !== null" class="detail-wrap">
          <TaskDetail :task="openTask" @close="openTaskId = ''" />
        </div>
      </template>

      <!-- 我的任务 -->
      <template v-else>
        <p class="muted">
          当前身份：{{ session.actorLabel }}（{{ session.roleLabel }}）；只列出执行角色是「{{ session.roleLabel }}」的任务。
          换身份在「系统设置」页。
          <template v-if="roleSummaryText !== ''">当前各角色任务数：{{ roleSummaryText }}</template>
        </p>
        <EmptyState
          v-if="myTasks.length === 0"
          title="没有分配给当前身份的任务"
          sub="计划里的执行角色决定任务归属；可以切换身份查看其他角色的待办"
        />
        <div v-else class="cards">
          <TaskCard v-for="task in myTasks" :key="task.id" :task="task" @open="openTaskDetail" />
        </div>
        <div v-if="openTask !== null" class="detail-wrap">
          <TaskDetail :task="openTask" @close="openTaskId = ''" />
        </div>
      </template>
    </SectionCard>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.tab {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  cursor: pointer;
  text-align: left;
}

.tab b {
  font-size: 13px;
  color: var(--text-1);
}

.tab span {
  font-size: 11px;
  color: var(--text-3);
}

.tab--active {
  border-color: var(--brand-500);
  box-shadow: inset 0 0 0 1px var(--brand-500);
}

.actions {
  margin-bottom: 12px;
}

.form-wrap {
  border: 1px solid var(--brand-300, #9dc6cd);
  border-radius: var(--r-sm);
  padding: 14px;
  margin-bottom: 14px;
  background: var(--bg-2, #f6f8f8);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
  gap: 12px;
}

.detail-wrap {
  margin-top: 14px;
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
@media (max-width: 600px) {
  .actions { flex-direction: column; align-items: flex-start; gap: 10px; }
  .tabs { gap: 6px; }.tab { flex: 1; min-width: 0; padding: 8px 10px; }
}
</style>

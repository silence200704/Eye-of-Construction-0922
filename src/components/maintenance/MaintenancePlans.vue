<script setup lang="ts">
/**
 * 保养计划列表与启停（工作台「保养计划」区）。
 *
 * 计划一改，后面所有周期任务都跟着变，所以新建/编辑/启停全部走 `useMaintenancePlanStore()` 的受控入口：
 * 权限、编号分配、审计日志都在那里，页面只负责收集与提示（失败时原样显示 store 返回的 error）。
 */
import { computed, ref } from 'vue'
import type { Device } from '@/types/domain'
import type { MaintenancePlan } from '@/types/maintenance'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useSessionStore } from '@/stores/session'
import { useClockStore } from '@/stores/clock'
import { planNextRunDate } from '@/core/maintenance/board'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import MaintenancePlanForm from './MaintenancePlanForm.vue'

const props = defineProps<{ devices: Device[] }>()

const plans = useMaintenancePlanStore()
const tasks = useMaintenanceTaskStore()
const session = useSessionStore()
const clock = useClockStore()

const editing = ref<MaintenancePlan | null>(null)
const formOpen = ref(false)
const pending = ref<MaintenancePlan | null>(null)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const busy = ref(false)

const canWrite = computed(() => session.role === 'safety')
const rows = computed(() => [...plans.plans].sort((a, b) => a.code.localeCompare(b.code)))

function notify(text: string, ok = true): void {
  tone.value = ok ? 'ok' : 'bad'
  message.value = text
}

function deviceLabelOf(deviceId: string): string {
  const device = props.devices.find((row) => row.id === deviceId)
  return device === undefined ? '（设备档案已删除）' : `${device.code} ${device.name}`
}

function cycleText(plan: MaintenancePlan): string {
  const unit = plan.cycle.unit === 'day' ? '天' : plan.cycle.unit === 'week' ? '周' : '月'
  return `每 ${plan.cycle.interval} ${unit} ${plan.cycle.atTime}`
}

/** 下次到期 = 按周期推算的下一次执行日；停用或窗口内无执行日时说清楚，不编日期。 */
function nextDueText(plan: MaintenancePlan): string {
  if (!plan.enabled) return '已停用，不再生成任务'
  const date = planNextRunDate(plan, clock.todayKey)
  return date === null ? '窗口内无执行日（已结束或周期超过一年）' : date
}

function openCreate(): void {
  editing.value = null
  formOpen.value = true
  message.value = ''
}

function openEdit(plan: MaintenancePlan): void {
  editing.value = plan
  formOpen.value = true
  message.value = ''
}

async function save(draft: Parameters<typeof plans.savePlan>[0]): Promise<void> {
  busy.value = true
  try {
    const result = await plans.savePlan(draft)
    if (!result.ok) {
      notify(result.error, false)
      return
    }
    notify(`已保存保养计划 ${result.label}（负责人 ${draft.owner}，检查项 ${draft.checklist.length} 条）`)
    formOpen.value = false
    editing.value = null
  } finally {
    busy.value = false
  }
}

/** 启停要确认：停用会让这条计划从此不再生成任务 */
async function toggleEnabled(): Promise<void> {
  const plan = pending.value
  if (plan === null) return
  busy.value = true
  try {
    const result = await plans.setEnabled(plan.id, !plan.enabled)
    if (!result.ok) {
      notify(result.error, false)
      return
    }
    notify(`${plan.enabled ? '已停用' : '已启用'}计划 ${plan.code}${plan.enabled ? '（不再生成新任务，历史任务与台账保留）' : ''}`)
    pending.value = null
  } finally {
    busy.value = false
  }
}

async function generateToday(): Promise<void> {
  busy.value = true
  try {
    const result = await tasks.generateForDay(clock.todayKey)
    notify(result.ok ? `按计划生成今日任务：${result.label}` : result.error, result.ok)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="plans">
    <div class="row-between actions">
      <span class="muted">
        共 {{ rows.length }} 个计划（启用中 {{ plans.activePlans.length }} 个）｜
        任务的执行范围与负责人取自生成当时的计划快照，事后改计划不追溯改写历史任务
      </span>
      <div class="row">
        <AppButton size="sm" :disabled="busy" @click="generateToday">生成今日任务</AppButton>
        <AppButton size="sm" variant="primary" :disabled="busy || !canWrite" @click="openCreate">新建计划</AppButton>
      </div>
    </div>

    <p v-if="!canWrite" class="notice notice--warn">
      当前身份是「{{ session.roleLabel }}」：保养计划的建立与启停由学校安全管理人员执行，写入侧会拦截。
      可在「系统设置」页切换身份。
    </p>
    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <div v-if="formOpen" class="form-wrap">
      <MaintenancePlanForm
        :plan="editing"
        :devices="devices"
        :today-key="clock.todayKey"
        @save="save"
        @cancel="formOpen = false; editing = null"
      />
    </div>

    <DataTable
      :columns="[
        { key: 'code', label: '计划编号', width: '176px' },
        { key: 'name', label: '计划 / 设备' },
        { key: 'cycle', label: '周期', width: '130px' },
        { key: 'owner', label: '负责人', width: '126px' },
        { key: 'state', label: '状态', width: '92px' },
        { key: 'due', label: '下次到期', width: '176px' },
        { key: 'act', label: '操作', width: '96px' },
      ]"
      :row-count="rows.length"
      empty="还没有保养计划：先新建一条计划，再用「生成今日任务」产生待办"
    >
      <tr v-for="plan in rows" :key="plan.id">
        <td class="mono">{{ plan.code }}</td>
        <td>
          <b>{{ plan.name }}</b>
          <div class="muted">{{ deviceLabelOf(plan.deviceId) }}｜检查项 {{ plan.checklist.length }} 条</div>
        </td>
        <td class="mono">{{ cycleText(plan) }}</td>
        <td>{{ plan.owner || '负责人待补充' }}</td>
        <td><StatusTag :tone="plan.enabled ? 'green' : 'gray'" :text="plan.enabled ? '启用中' : '已停用'" /></td>
        <td class="mono">{{ nextDueText(plan) }}</td>
        <td>
          <div class="row">
            <button class="link" type="button" @click="openEdit(plan)">编辑</button>
            <button class="link" type="button" @click="pending = plan">{{ plan.enabled ? '停用' : '启用' }}</button>
          </div>
        </td>
      </tr>
    </DataTable>

    <p class="field-hint">
      「生成今日任务」按周期命中今天、且计划处于启用中时生成待办；同一计划同一执行时刻只会有一条任务，
      重复点击不会产生重复任务，返回结果会给出新生成与已存在的条数。
    </p>

    <AppModal
      :open="pending !== null"
      :title="pending?.enabled === true ? '停用保养计划' : '启用保养计划'"
      :sub="pending === null ? '' : `${pending.code} ${pending.name}`"
      :width="480"
      @close="pending = null"
    >
      <p class="notice notice--warn">
        <template v-if="pending?.enabled === true">
          停用后该计划不再生成新任务；已生成的任务、执行记录与照片全部保留。确认停用？
        </template>
        <template v-else>启用后该计划从下一次周期命中起重新生成任务，历史任务不受影响。确认启用？</template>
      </p>
      <template #footer>
        <AppButton @click="pending = null">取消</AppButton>
        <AppButton variant="primary" :disabled="busy" @click="toggleEnabled">确认</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.plans {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.actions {
  gap: 10px;
  align-items: center;
}

.form-wrap {
  border: 1px solid var(--brand-300, #9dc6cd);
  border-radius: var(--r-sm);
  padding: 14px;
  background: var(--bg-2, #f6f8f8);
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

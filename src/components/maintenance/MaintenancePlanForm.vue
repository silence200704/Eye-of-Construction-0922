<script setup lang="ts">
/**
 * 保养计划表单（新建 / 编辑）。
 *
 * 只负责收集与本地必填校验，**判定仍在写入侧**：提交前过一遍 `validateMaintenancePlan`
 * 是为了让用户早点看到缺什么，真正的校验与编号分配在 `savePlan` 的写入事务里。
 */
import { computed, ref, watch } from 'vue'
import type { Device } from '@/types/domain'
import type { ChecklistItem, PlanCycleUnit } from '@/types/inspection'
import { PLAN_CYCLE_UNITS } from '@/types/inspection'
import type { MaintenancePlan } from '@/types/maintenance'
import type { MaintenancePlanDraft } from '@/stores/maintenance/plans'
import { validateMaintenancePlan } from '@/core/maintenance/plan'
import { DEMO_PEOPLE, MANUAL_OWNER } from '@/config/people'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ plan: MaintenancePlan | null; devices: Device[]; todayKey: string }>()
const emit = defineEmits<{ save: [draft: MaintenancePlanDraft]; cancel: [] }>()

const model = ref({ name: '', deviceId: '', unit: 'month' as PlanCycleUnit, interval: 1, atTime: '09:00', startDate: '', endDate: '', remark: '' })
/** 负责人从演示名单里选，选"其他人员"才手动填；名单只是减少输入，不代表权限。 */
const ownerPick = ref(DEMO_PEOPLE[0]?.name ?? MANUAL_OWNER)
const ownerManual = ref('')
const checklist = ref<ChecklistItem[]>([])
const errors = ref<string[]>([])

const owner = computed(() => (ownerPick.value === MANUAL_OWNER ? ownerManual.value : ownerPick.value))
const deviceLabel = (device: Device): string => `${device.code} ${device.name}`

function resetFrom(plan: MaintenancePlan | null): void {
  errors.value = []
  if (plan === null) {
    model.value = {
      name: '',
      deviceId: props.devices[0]?.id ?? '',
      unit: 'month',
      interval: 1,
      atTime: '09:00',
      startDate: props.todayKey,
      endDate: '',
      remark: '',
    }
    ownerPick.value = DEMO_PEOPLE[0]?.name ?? MANUAL_OWNER
    ownerManual.value = ''
    checklist.value = [{ key: 'item_1', label: '', required: true, hint: '' }]
    return
  }
  model.value = {
    name: plan.name,
    deviceId: plan.deviceId,
    unit: plan.cycle.unit,
    interval: plan.cycle.interval,
    atTime: plan.cycle.atTime,
    startDate: plan.startDate,
    endDate: plan.endDate ?? '',
    remark: plan.remark,
  }
  const matched = DEMO_PEOPLE.some((person) => person.name === plan.owner)
  ownerPick.value = matched ? plan.owner : MANUAL_OWNER
  ownerManual.value = matched ? '' : plan.owner
  checklist.value = plan.checklist.map((item) => ({ ...item }))
}

watch(() => props.plan, resetFrom, { immediate: true })

function addItem(): void {
  checklist.value = [...checklist.value, { key: `item_${checklist.value.length + 1}`, label: '', required: true, hint: '' }]
}

function removeItem(index: number): void {
  checklist.value = checklist.value.filter((_, i) => i !== index)
}

function buildDraft(): MaintenancePlanDraft {
  return {
    id: props.plan?.id ?? null,
    name: model.value.name,
    deviceId: model.value.deviceId,
    cycle: { unit: model.value.unit, interval: Number(model.value.interval) || 1, atTime: model.value.atTime },
    startDate: model.value.startDate,
    endDate: model.value.endDate === '' ? null : model.value.endDate,
    owner: owner.value.trim(),
    checklist: checklist.value.map((item) => ({ ...item })),
    remark: model.value.remark,
  }
}

function submit(): void {
  const draft = buildDraft()
  // 空检查项在这里先滤掉：空名称的项没有任何执行依据，留着只会在执行时变成一条答不了的题
  const check = validateMaintenancePlan({ ...draft, checklist: draft.checklist.filter((item) => item.label.trim() !== '') })
  errors.value = check.errors
  if (!check.ok) return
  emit('save', draft)
}
</script>

<template>
  <div class="plan-form">
    <p v-if="errors.length > 0" class="notice notice--warn">请先处理：{{ errors.join('；') }}</p>
    <p v-if="devices.length === 0" class="notice notice--warn">
      还没有设备档案：保养计划必须绑定一台真实设备，请先到「建筑与设备」页登记设备。
    </p>

    <div class="grid">
      <label class="field">
        <span>计划名称 <b>*</b></span>
        <input v-model="model.name" class="ctl" placeholder="例如 裂缝位移探头月度保养" />
      </label>
      <label class="field">
        <span>保养设备 <b>*</b></span>
        <select v-model="model.deviceId" class="ctl">
          <option value="">请选择设备</option>
          <option v-for="device in devices" :key="device.id" :value="device.id">{{ deviceLabel(device) }}</option>
        </select>
        <em class="field-hint">一台设备可以有多条计划（例如月度外观保养 + 年度标定），台账取启用中的那条为当前计划</em>
      </label>
      <label class="field">
        <span>保养周期</span>
        <div class="row">
          <select v-model="model.unit" class="ctl">
            <option v-for="item in PLAN_CYCLE_UNITS" :key="item.key" :value="item.key">{{ item.name }}</option>
          </select>
          <input v-model="model.interval" class="ctl num" type="number" min="1" max="60" />
          <span class="muted">次</span>
        </div>
      </label>
      <label class="field">
        <span>执行时刻 <b>*</b></span>
        <input v-model="model.atTime" class="ctl" type="time" />
        <em class="field-hint">任务按这个时刻生成；过了执行日 23:59 还没完成才算逾期</em>
      </label>
      <label class="field">
        <span>开始日期 <b>*</b></span>
        <input v-model="model.startDate" class="ctl" type="date" />
        <em class="field-hint">每月计划若起始日超出当月天数，自动落到当月最后一天</em>
      </label>
      <label class="field">
        <span>结束日期</span>
        <input v-model="model.endDate" class="ctl" type="date" />
      </label>
      <label class="field">
        <span>保养负责人 <b>*</b></span>
        <select v-model="ownerPick" class="ctl">
          <option v-for="person in DEMO_PEOPLE" :key="person.name" :value="person.name">{{ person.name }}</option>
          <option :value="MANUAL_OWNER">其他人员（手动填写）</option>
        </select>
        <input v-if="ownerPick === MANUAL_OWNER" v-model="ownerManual" class="ctl" placeholder="填写姓名与部门，例如 陈老师（后勤保障处）" />
        <em class="field-hint">执行保养时按这个名字校验：只有负责人本人（或物业值班代执行并写明原因）能提交</em>
      </label>
    </div>

    <div class="field">
      <span>保养检查项 <b>*</b></span>
      <div v-for="(item, index) in checklist" :key="index" class="row checklist-row">
        <input v-model="item.label" class="ctl" placeholder="检查项，例如 固定螺栓是否牢固" />
        <label class="check"><input v-model="item.required" type="checkbox" />必答</label>
        <button class="link" type="button" @click="removeItem(index)">删除</button>
      </div>
      <button class="link" type="button" @click="addItem">+ 添加检查项</button>
      <em class="field-hint">执行时逐项作答；必答项不作答不能提交，异常项必须写明描述</em>
    </div>

    <label class="field">
      <span>备注</span>
      <textarea v-model="model.remark" class="ctl" rows="2" />
    </label>

    <div class="row-between foot">
      <span class="muted">保存会在写入事务里分配计划编号并记操作日志</span>
      <span class="row">
        <AppButton size="sm" @click="emit('cancel')">取消</AppButton>
        <AppButton size="sm" variant="primary" :disabled="devices.length === 0" @click="submit">保存计划</AppButton>
      </span>
    </div>
  </div>
</template>

<style scoped>
.plan-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
}

.field b {
  color: var(--state-red, #c0362c);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-1);
  white-space: nowrap;
}

.checklist-row {
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.checklist-row .ctl {
  flex: 1;
}

.num {
  width: 72px;
}

.link {
  align-self: flex-start;
  border: 0;
  background: none;
  color: var(--brand-700);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}

.foot {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}
</style>

<script setup lang="ts">
/**
 * 巡检计划表单。
 *
 * 与服务端无关的现场规则都在这里体现：
 * 必查点按所选楼层过滤（选不到别的楼栋的点），提交前过 validatePlan 校验归属，
 * 检查清单模板是"到点要逐项回答"的问题清单，必答项缺一不可。
 */
import { computed, ref, watch } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import type { PlanDraft } from '@/stores/inspection/plans'
import type { ChecklistItem, InspectionPlan, PlanKind } from '@/types/inspection'
import { PLAN_CYCLE_UNITS, PLAN_KINDS } from '@/types/inspection'
import { ROLES } from '@/types/catalog'
import { validatePlan, pointPoolHint } from '@/core/inspection/taskPlan'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ plan: InspectionPlan | null }>()
const emit = defineEmits<{ save: [draft: PlanDraft]; cancel: [] }>()

const archive = useArchiveStore()

const model = ref({
  name: '',
  kind: 'patrol' as PlanKind,
  buildingId: '',
  floorIds: [] as string[],
  pointIds: [] as string[],
  unit: 'day' as 'day' | 'week' | 'month',
  interval: 1,
  atTime: '09:00',
  startDate: '',
  endDate: '',
  owner: '',
  executorRole: 'inspector',
  enabled: true,
  remark: '',
})
const checklist = ref<ChecklistItem[]>([])
const errors = ref<string[]>([])

const floors = computed(() => (model.value.buildingId === '' ? [] : archive.floorsOf(model.value.buildingId)))
const pointsOfFloors = computed(() =>
  archive.points.filter((row) => row.status === 'active' && model.value.floorIds.includes(row.floorId)),
)

/** 本楼栋的在册测点与楼层 id 集合：用于把"必查点为空"的真实原因说清楚。 */
const buildingPoints = computed(() =>
  model.value.buildingId === ''
    ? []
    : archive.points.filter((row) => row.status === 'active' && row.buildingId === model.value.buildingId),
)
const floorIdSet = computed(() => new Set(floors.value.map((row) => row.id)))

/** 必查点为空时的说明：三种原因分开说，判定在 core 里（见 pointPoolHint）。 */
const pointEmptyHint = computed(() =>
  pointPoolHint({
    selectedFloorIds: model.value.floorIds,
    buildingPoints: buildingPoints.value,
    buildingFloorIds: floorIdSet.value,
    floorNameOf: (floorId) => archive.floorById(floorId)?.name ?? '楼层已不存在',
  }),
)

function toggle(list: 'floorIds' | 'pointIds', id: string): void {
  const current = model.value[list]
  model.value[list] = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
}

watch(
  () => props.plan,
  (plan) => {
    errors.value = []
    if (plan === null) {
      model.value = {
        name: '',
        kind: 'patrol',
        buildingId: archive.buildings[0]?.id ?? '',
        floorIds: [],
        pointIds: [],
        unit: 'day',
        interval: 1,
        atTime: '09:00',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: '',
        owner: '',
        executorRole: 'inspector',
        enabled: true,
        remark: '',
      }
      checklist.value = []
      return
    }
    model.value = {
      name: plan.name,
      kind: plan.kind,
      buildingId: plan.buildingId,
      floorIds: [...plan.floorIds],
      pointIds: [...plan.pointIds],
      unit: plan.cycle.unit,
      interval: plan.cycle.interval,
      atTime: plan.cycle.atTime,
      startDate: plan.startDate,
      endDate: plan.endDate ?? '',
      owner: plan.owner,
      executorRole: plan.executorRole,
      enabled: plan.enabled,
      remark: plan.remark,
    }
    checklist.value = plan.checklist.map((item) => ({ ...item }))
  },
  { immediate: true },
)

/** 换楼栋时清掉不属于该楼栋的楼层与必查点，避免留下越界选择。 */
watch(
  () => model.value.buildingId,
  (buildingId, previous) => {
    if (previous === undefined || buildingId === previous) return
    const validFloors = new Set(floors.value.map((row) => row.id))
    model.value.floorIds = model.value.floorIds.filter((id) => validFloors.has(id))
    model.value.pointIds = []
  },
)

function addChecklistItem(): void {
  checklist.value = [...checklist.value, { key: `item_${checklist.value.length + 1}`, label: '', required: true, hint: '' }]
}

function removeChecklistItem(index: number): void {
  checklist.value = checklist.value.filter((_, i) => i !== index)
}

function buildDraft(): PlanDraft {
  return {
    name: model.value.name,
    kind: model.value.kind,
    buildingId: model.value.buildingId,
    floorIds: [...model.value.floorIds],
    pointIds: [...model.value.pointIds],
    cycle: { unit: model.value.unit, interval: Number(model.value.interval) || 1, atTime: model.value.atTime },
    startDate: model.value.startDate,
    endDate: model.value.endDate === '' ? null : model.value.endDate,
    owner: model.value.owner,
    executorRole: model.value.executorRole,
    checklist: checklist.value.filter((item) => item.label.trim() !== ''),
    enabled: model.value.enabled,
    remark: model.value.remark,
  }
}

function submit(): void {
  const draft = buildDraft()
  const check = validatePlan(
    { ...draft },
    { buildings: archive.buildings, floors: archive.floors, points: archive.points },
  )
  errors.value = check.errors
  if (!check.ok) return
  emit('save', draft)
}
</script>

<template>
  <div class="plan-form">
    <p v-if="errors.length > 0" class="notice notice--warn">
      请先处理：{{ errors.join('；') }}
    </p>

    <div class="grid">
      <label class="field">
        <span>计划名称 <b>*</b></span>
        <input v-model="model.name" class="ctl" placeholder="例如 二层走廊日巡检" />
      </label>
      <label class="field">
        <span>计划类型</span>
        <select v-model="model.kind" class="ctl">
          <option v-for="item in PLAN_KINDS" :key="item.key" :value="item.key">{{ item.name }}</option>
        </select>
        <em class="field-hint">{{ PLAN_KINDS.find((row) => row.key === model.kind)?.desc }}</em>
      </label>
      <label class="field">
        <span>所属楼栋 <b>*</b></span>
        <select v-model="model.buildingId" class="ctl">
          <option v-for="row in archive.buildings" :key="row.id" :value="row.id">{{ row.code }} {{ row.name }}</option>
        </select>
      </label>
      <label class="field">
        <span>执行角色</span>
        <select v-model="model.executorRole" class="ctl">
          <option v-for="role in ROLES" :key="role.key" :value="role.key">{{ role.name }}</option>
        </select>
      </label>
    </div>

    <div class="grid">
      <div class="field">
        <span>覆盖楼层 <b>*</b></span>
        <div class="checks">
          <label v-for="floor in floors" :key="floor.id" class="check">
            <input type="checkbox" :checked="model.floorIds.includes(floor.id)" @change="toggle('floorIds', floor.id)" />
            {{ floor.name }}
          </label>
          <span v-if="floors.length === 0" class="muted">该楼栋还没有楼层档案</span>
        </div>
      </div>
      <div class="field">
        <span>必查点 <b>*</b></span>
        <div class="checks">
          <label v-for="point in pointsOfFloors" :key="point.id" class="check">
            <input type="checkbox" :checked="model.pointIds.includes(point.id)" @change="toggle('pointIds', point.id)" />
            {{ point.code }}
          </label>
          <span v-if="pointsOfFloors.length === 0" class="muted">{{ pointEmptyHint }}</span>
        </div>
        <em class="field-hint">只能选所选楼层里的在册测点；人工检查点也可以作为必查点</em>
      </div>
    </div>

    <div class="grid">
      <label class="field">
        <span>周期</span>
        <div class="row">
          <select v-model="model.unit" class="ctl">
            <option v-for="item in PLAN_CYCLE_UNITS" :key="item.key" :value="item.key">{{ item.name }}</option>
          </select>
          <input v-model="model.interval" class="ctl num" type="number" min="1" max="30" />
          <span class="muted">次</span>
        </div>
      </label>
      <label class="field">
        <span>执行时刻</span>
        <input v-model="model.atTime" class="ctl" type="time" />
        <em class="field-hint">任务按这个时刻生成，逾期未检会在待办里标出</em>
      </label>
      <label class="field">
        <span>开始日期 <b>*</b></span>
        <input v-model="model.startDate" class="ctl" type="date" />
        <em class="field-hint">每月计划若起始日超出当月天数，落到当月最后一天</em>
      </label>
      <label class="field">
        <span>结束日期</span>
        <input v-model="model.endDate" class="ctl" type="date" />
      </label>
      <label class="field">
        <span>计划负责人</span>
        <input v-model="model.owner" class="ctl" placeholder="例如 李老师（后勤保障处）" />
      </label>
      <label class="field">
        <span>启用</span>
        <div class="row">
          <input v-model="model.enabled" type="checkbox" />
          <span class="muted">停用后不再生成新任务，既有任务保留</span>
        </div>
      </label>
    </div>

    <div class="field">
      <span>检查清单模板</span>
      <div v-for="(item, index) in checklist" :key="index" class="row checklist-row">
        <input v-model="item.label" class="ctl" placeholder="检查项，例如 探头固定是否牢靠" />
        <label class="check"><input v-model="item.required" type="checkbox" />必答</label>
        <button class="link" type="button" @click="removeChecklistItem(index)">删除</button>
      </div>
      <button class="link" type="button" @click="addChecklistItem">+ 添加检查项</button>
      <em class="field-hint">清单项在到点打卡后逐项回答；必答项不作答不能提交问题或完成检查</em>
    </div>

    <label class="field">
      <span>备注</span>
      <textarea v-model="model.remark" class="ctl" rows="2" />
    </label>

    <div class="row-between foot">
      <AppButton size="sm" @click="emit('cancel')">取消</AppButton>
      <AppButton size="sm" variant="primary" @click="submit">保存计划</AppButton>
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

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  min-height: 34px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-1);
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

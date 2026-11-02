<script setup lang="ts">
/** 楼层建档：楼层号自动推导楼层名称与默认区域清单，减少手工输入。 */
import { computed, watch } from 'vue'
import type { Floor } from '@/types/domain'
import { floorFields } from '@/config/fields/floorFields'
import { parseZones, pointsInRemovedZones, saveFloor, type FloorDraft } from '@/stores/writes/archiveWrites'
import { useArchiveStore } from '@/stores/archive'
import { floorName } from '@/core/id'
import { parseNum } from '@/core/format'
import { useFormModel } from '@/core/useForm'
import type { ValidationIssue } from '@/types/forms'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'

const props = defineProps<{ open: boolean; floor: Floor | null; defaultBuildingId: string }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()

const archive = useArchiveStore()
const fields = computed(() =>
  floorFields(
    archive.buildings
      .filter((row) => row.status === 'active')
      .map((row) => ({ value: row.id, label: `${row.code} ${row.name}` })),
  ),
)
const { model, errors, submitError, pending, reset, mergeIssues, run } = useFormModel(() => fields.value)

function str(key: string): string {
  return String(model.value[key] ?? '').trim()
}

function defaultZones(name: string): string {
  const prefix = name === '' ? '本层' : name
  return [0, 1, 2, 3, 4, 5].map((index) => `${prefix}${['走廊', '西侧房间', '楼梯间', '东侧房间', '休息室', '资料室'][index]}`).join('、')
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const target = props.floor
    if (target === null) {
      reset({
        buildingId: props.defaultBuildingId,
        floorNo: '',
        name: '',
        zonesText: '',
        planVersion: 1,
        remark: '',
      })
      return
    }
    reset({
      buildingId: target.buildingId,
      floorNo: target.floorNo,
      name: target.name,
      zonesText: target.zones.join('、'),
      planVersion: target.planVersion,
      remark: target.remark,
    })
  },
)

/** 楼层号变化时补全楼层名称与区域清单，用户已填写的内容不覆盖。 */
function onFloorNoChange(): void {
  const no = parseNum(String(model.value.floorNo ?? ''))
  if (no === null) return
  if (str('name') === '') {
    const name = floorName(no)
    model.value.name = name
    if (str('zonesText') === '') model.value.zonesText = defaultZones(name)
  }
}

function buildDraft(): FloorDraft {
  return {
    buildingId: str('buildingId'),
    floorNo: parseNum(String(model.value.floorNo ?? '')) ?? 0,
    name: str('name'),
    zonesText: str('zonesText'),
    planVersion: parseNum(String(model.value.planVersion ?? '')) ?? 1,
    remark: String(model.value.remark ?? '').trim(),
  }
}

async function submit(): Promise<void> {
  if (!mergeIssues([])) return
  const draft = buildDraft()
  const extra: ValidationIssue[] = []
  if (draft.zonesText.split(/[、,，;；\s]+/).filter((item) => item !== '').length < 2) {
    extra.push({ field: 'zonesText', message: '至少填写走廊与一个房间，否则楼层图无法生成' })
  }
  const duplicate = archive.floors.find(
    (row) => row.buildingId === draft.buildingId && row.floorNo === draft.floorNo && row.id !== props.floor?.id,
  )
  if (duplicate !== undefined) {
    extra.push({ field: 'floorNo', message: `${archive.buildingName(draft.buildingId)} 已存在该楼层号（${duplicate.name}）` })
  }
  if (props.floor !== null) {
    const orphans = pointsInRemovedZones(props.floor.id, parseZones(draft.zonesText))
    if (orphans.length > 0) {
      extra.push({
        field: 'zonesText',
        message: `有 ${orphans.length} 个测点仍在引用将被删除的区域（${orphans
          .map((row) => row.code)
          .join('、')}），请先调整这些测点或保留区域名称`,
      })
    }
  }
  if (extra.length > 0) {
    mergeIssues(extra)
    return
  }
  let savedId = ''
  const ok = await run(async () => {
    const row = await saveFloor(props.floor?.id ?? null, draft)
    savedId = row.id
  })
  if (ok) {
    emit('saved', savedId)
    emit('close')
  }
}
</script>

<template>
  <AppModal
    :open="open"
    :title="floor === null ? '新建楼层' : `编辑楼层 · ${floor.name}`"
    sub="楼层图由区域名称生成，底图换版后需先核对测点标记位置再发布"
    :width="720"
    @close="emit('close')"
  >
    <FormGrid v-model="model" :fields="fields" :errors="errors" @change="onFloorNoChange" />
    <p v-if="submitError !== ''" class="notice notice--warn submit-error">保存失败：{{ submitError }}</p>
    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton variant="primary" :loading="pending" @click="submit">保存楼层</AppButton>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
/** 测点建档：档案字段 + 楼层图落点定位，楼层与区域随楼栋联动。 */
import { computed, ref, watch } from 'vue'
import type { NormPoint, Point, PointType } from '@/types/domain'
import { pointFields } from '@/config/fields/pointFields'
import { locationChanged, savePoint, suggestPointCode, type PointDraft } from '@/stores/writes/archiveWrites'
import { useArchiveStore } from '@/stores/archive'
import { useFormModel } from '@/core/useForm'
import { todayInput } from '@/core/time'
import type { ValidationIssue } from '@/types/forms'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import FloorMap from '@/components/map/FloorMap.vue'

const props = defineProps<{ open: boolean; point: Point | null; defaultBuildingId: string }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()

const archive = useArchiveStore()
/** 楼栋、楼层、区域或图上坐标任一变化即视为移动，必须填写变更原因。 */
const locationMoved = computed(() =>
  props.point === null ? false : locationChanged(props.point, buildDraft()),
)

const fields = computed(() => {
  const list = pointFields({
    buildings: archive.buildings.filter((row) => row.status === 'active'),
    floorsOf: (buildingId) => archive.floorsOf(buildingId),
    zonesOf: (floorId) => archive.floorById(floorId)?.zones ?? [],
  })
  if (locationMoved.value) {
    list.push({
      key: 'locationReason',
      label: '位置变更原因',
      type: 'textarea',
      span: 2,
      rows: 2,
      required: true,
      placeholder: '例如 探头移位至走廊东侧，避开施工遮挡',
      hint: '位置变更按新增记录留痕，原位置完整保留在变更历史中',
    })
  }
  return list
})
const { model, errors, submitError, pending, reset, mergeIssues, run } = useFormModel(() => fields.value)
const coord = ref<NormPoint>({ x: 0.5, y: 0.5 })

const selectedFloor = computed(() => archive.floorById(String(model.value.floorId ?? '')) ?? null)
const floorPoints = computed(() => (selectedFloor.value === null ? [] : archive.pointsOfFloor(selectedFloor.value.id, true)))
const draftType = computed<PointType>(() => (String(model.value.type ?? 'crack') as PointType))
const levelLabel = computed(() => {
  const floor = selectedFloor.value
  if (floor === null) return ''
  return `${archive.buildingName(floor.buildingId)} ${floor.name}`
})

function str(key: string): string {
  return String(model.value[key] ?? '').trim()
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const target = props.point
    if (target === null) {
      reset({
        code: '',
        name: '',
        buildingId: props.defaultBuildingId,
        floorId: '',
        zoneId: '',
        type: 'crack',
        owner: '',
        backupPerson: '',
        installDate: todayInput(),
        dataSource: 'real',
        remark: '',
        nfcLabel: '',
        locationReason: '',
      })
      coord.value = { x: 0.5, y: 0.5 }
      const floors = archive.floorsOf(props.defaultBuildingId)
      if (floors.length > 0) {
        model.value.floorId = floors[0].id
        model.value.zoneId = floors[0].zones[0] ?? ''
      }
      refreshCode()
      return
    }
    reset({
      code: target.code,
      name: target.name,
      buildingId: target.buildingId,
      floorId: target.floorId,
      zoneId: target.zoneId,
      type: target.type,
      owner: target.owner,
      backupPerson: target.backupPerson,
      installDate: target.installDate,
      dataSource: target.dataSource,
      remark: target.remark,
      nfcLabel: target.nfc?.code ?? '',
      locationReason: '',
    })
    coord.value = { ...target.coord }
  },
)

function refreshCode(): void {
  if (props.point !== null) return
  const code = suggestPointCode(String(model.value.buildingId ?? ''), String(model.value.floorId ?? ''), draftType.value)
  if (code !== '') model.value.code = code
}

watch(() => model.value.buildingId, () => {
  const floors = archive.floorsOf(String(model.value.buildingId ?? ''))
  const current = String(model.value.floorId ?? '')
  if (!floors.some((row) => row.id === current)) {
    model.value.floorId = floors.length === 1 ? floors[0].id : ''
    model.value.zoneId = ''
    refreshCode()
  }
})

watch([() => model.value.floorId, () => model.value.type], () => {
  const floor = selectedFloor.value
  const zones = floor?.zones ?? []
  if (!zones.includes(String(model.value.zoneId ?? ''))) {
    model.value.zoneId = zones.length > 0 ? zones[0] : ''
  }
  refreshCode()
})

/** 点击楼层图空白处落点；拖拽标记走 update:draft。 */
function onPick(point: NormPoint): void {
  coord.value = point
}

function buildDraft(): PointDraft {  return {
    code: str('code'),
    name: str('name'),
    buildingId: str('buildingId'),
    floorId: str('floorId'),
    zoneId: str('zoneId'),
    type: draftType.value,
    coord: { ...coord.value },
    planVersion: selectedFloor.value?.planVersion ?? 1,
    owner: str('owner'),
    backupPerson: str('backupPerson'),
    installDate: str('installDate'),
    dataSource: model.value.dataSource === 'demo' ? 'demo' : 'real',
    remark: String(model.value.remark ?? '').trim(),
    nfcLabel: String(model.value.nfcLabel ?? '').trim(),
    locationReason: String(model.value.locationReason ?? '').trim(),
  }
}

async function submit(): Promise<void> {
  if (!mergeIssues([])) return
  const draft = buildDraft()
  const extra: ValidationIssue[] = []
  const duplicate = archive.points.find((row) => row.code === draft.code && row.id !== props.point?.id)
  if (duplicate !== undefined) {
    extra.push({ field: 'code', message: `测点编号 ${draft.code} 已存在` })
  }
  if (extra.length > 0) {
    mergeIssues(extra)
    return
  }
  let savedId = ''
  const ok = await run(async () => {
    const row = await savePoint(props.point?.id ?? null, draft)
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
    :title="point === null ? '新建测点' : `编辑测点 · ${point.code}`"
    sub="测点编号在档案中唯一；类型决定录入字段与判定指标"
    :width="1080"
    @close="emit('close')"
  >
    <div class="split">
      <div>
        <FormGrid v-model="model" :fields="fields" :errors="errors" :columns="1" />
        <p class="pos-line">
          图上位置：<span class="num">X {{ coord.x.toFixed(3) }} / Y {{ coord.y.toFixed(3) }}</span>
          <span class="muted">（归一化坐标，底图版本 v{{ selectedFloor?.planVersion ?? 1 }}）</span>
        </p>
      </div>
      <div>
        <div class="pane-title">楼层图落点</div>
        <FloorMap
          :floor="selectedFloor"
          :points="floorPoints"
          :level-label="levelLabel"
          :draft-type="draftType"
          :draft-coord="coord"
          :height="330"
          pickable
          @pick="onPick"
          @update:draft="coord = $event"
        />
        <p class="field-hint">在楼层图上点击落点，或拖拽标记微调；错位点位会导致后续检查人员找错现场。</p>
      </div>
    </div>

    <p v-if="submitError !== ''" class="notice notice--warn submit-error">保存失败：{{ submitError }}</p>

    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton variant="primary" :loading="pending" @click="submit">保存测点</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 460px;
  gap: 22px;
}

.pane-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 8px;
}

.pos-line {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-2);
}

@media (max-width: 1100px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

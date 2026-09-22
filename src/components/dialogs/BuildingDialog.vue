<script setup lang="ts">
/** 楼栋建档：档案字段 + 校园图实地标绘（点击落位、拖拽微调）。 */
import { computed, ref, watch } from 'vue'
import type { Building, Footprint, NormPoint } from '@/types/domain'
import { buildingFields } from '@/config/fields/buildingFields'
import { saveBuilding, suggestBuildingCode, type BuildingDraft } from '@/stores/writes/archiveWrites'
import { useArchiveStore } from '@/stores/archive'
import { useFormModel } from '@/core/useForm'
import { parseNum } from '@/core/format'
import type { ValidationIssue } from '@/types/forms'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import CampusMap from '@/components/map/CampusMap.vue'

const props = defineProps<{ open: boolean; building: Building | null }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()

const archive = useArchiveStore()
const fields = computed(() => buildingFields())
const { model, errors, submitError, reset, mergeIssues, run } = useFormModel(() => fields.value)
const footprint = ref<Footprint>({ x: 0.5, y: 0.5, w: 0.18, h: 0.16, rotate: 0 })

function str(key: string): string {
  return String(model.value[key] ?? '').trim()
}

function num(key: string): number | null {
  return parseNum(String(model.value[key] ?? ''))
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const target = props.building
    if (target === null) {
      reset({
        code: suggestBuildingCode(),
        name: '',
        purpose: '',
        structureType: '框架结构',
        buildYear: '',
        floorCount: '',
        area: '',
        managerUnit: '',
        userUnit: '',
        owner: '',
        ownerPhone: '',
        backupPerson: '',
        source: '',
        dataSource: 'real',
        remark: '',
      })
      footprint.value = { x: 0.5, y: 0.5, w: 0.18, h: 0.16, rotate: 0 }
      return
    }
    reset({
      code: target.code,
      name: target.name,
      purpose: target.purpose,
      structureType: target.structureType,
      buildYear: target.buildYear ?? '',
      floorCount: target.floorCount ?? '',
      area: target.area ?? '',
      managerUnit: target.managerUnit,
      userUnit: target.userUnit,
      owner: target.owner,
      ownerPhone: target.ownerPhone,
      backupPerson: target.backupPerson,
      source: target.source,
      dataSource: target.dataSource,
      remark: target.remark,
    })
    footprint.value = { ...target.footprint }
  },
)

function buildDraft(): BuildingDraft {
  return {
    code: str('code'),
    name: str('name'),
    purpose: str('purpose'),
    buildYear: num('buildYear'),
    floorCount: num('floorCount'),
    area: num('area'),
    structureType: str('structureType'),
    managerUnit: str('managerUnit'),
    userUnit: str('userUnit'),
    owner: str('owner'),
    ownerPhone: str('ownerPhone'),
    backupPerson: str('backupPerson'),
    source: str('source'),
    remark: str('remark'),
    dataSource: model.value.dataSource === 'demo' ? 'demo' : 'real',
    footprint: { ...footprint.value },
  }
}

function onSize(key: 'w' | 'h' | 'rotate', event: Event): void {
  const value = parseNum((event.target as HTMLInputElement).value)
  if (value === null) return
  footprint.value = { ...footprint.value, [key]: value }
}

/** 点击校园图空白处把楼栋占位移动到该点；拖拽走 update:draft。 */
function onPick(point: NormPoint): void {
  footprint.value = { ...footprint.value, x: point.x, y: point.y }
}

async function submit(): Promise<void> {
  const code = str('code')
  const extra: ValidationIssue[] = []
  const duplicate = archive.buildings.find((row) => row.code === code && row.id !== props.building?.id)
  if (duplicate !== undefined) {
    extra.push({ field: 'code', message: `楼栋编号 ${code} 已被「${duplicate.name}」占用` })
  }
  if (footprint.value.x < 0.02 || footprint.value.y < 0.02) {
    extra.push({ field: 'code', message: '图上位置过于靠边，请在地图上重新放置' })
  }
  if (!mergeIssues(extra)) return
  let savedId = ''
  const ok = await run(async () => {
    const row = await saveBuilding(props.building?.id ?? null, buildDraft())
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
    :title="building === null ? '新建楼栋档案' : `编辑楼栋档案 · ${building.code}`"
    sub="楼栋编号作为统一关联入口，连接楼层图、测点、设备与后续业务记录"
    :width="1080"
    @close="emit('close')"
  >
    <div class="split">
      <div class="pane-form">
        <FormGrid v-model="model" :fields="fields" :errors="errors" :columns="1" />
      </div>
      <div class="pane-map">
        <div class="pane-title">校园图位置标绘</div>
        <CampusMap
          v-model:draft="footprint"
          :buildings="archive.buildings"
          :active-id="building?.id ?? null"
          :height="330"
          pickable
          @pick="onPick"
        />
        <div class="size-row">
          <label class="size-item">
            <span>宽</span>
            <input class="ctl" type="number" step="0.01" min="0.05" max="0.5" :value="footprint.w" @input="onSize('w', $event)" />
          </label>
          <label class="size-item">
            <span>深</span>
            <input class="ctl" type="number" step="0.01" min="0.05" max="0.5" :value="footprint.h" @input="onSize('h', $event)" />
          </label>
          <label class="size-item">
            <span>朝向</span>
            <input class="ctl" type="number" step="1" min="-180" max="180" :value="footprint.rotate" @input="onSize('rotate', $event)" />
          </label>
        </div>
        <p class="field-hint">图上坐标为归一化示意值，不构成实测安装坐标；虚线框为占位，可拖拽或点击落位。</p>
      </div>
    </div>

    <p v-if="submitError !== ''" class="notice notice--warn submit-error">保存失败：{{ submitError }}</p>

    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton variant="primary" @click="submit">保存档案</AppButton>
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

.size-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.size-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
}

.size-item span {
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

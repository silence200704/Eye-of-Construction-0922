<script setup lang="ts">
/** 设备登记：绑定测点，记录型号、量程、安装与校准信息。 */
import { computed, watch } from 'vue'
import type { Device, DeviceHealth } from '@/types/domain'
import { deviceFields } from '@/config/fields/deviceFields'
import { saveDevice, suggestDeviceCode, type DeviceDraft } from '@/stores/writes/archiveWrites'
import { useArchiveStore } from '@/stores/archive'
import { metricDef } from '@/types/catalog'
import { parseNum } from '@/core/format'
import { useFormModel } from '@/core/useForm'
import { todayInput } from '@/core/time'
import type { ValidationIssue } from '@/types/forms'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'

const props = defineProps<{ open: boolean; device: Device | null; defaultPointId: string }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()

const archive = useArchiveStore()
const pointOptions = computed(() =>
  archive.activePoints.map((row) => ({ value: row.id, label: `${row.code} ${row.name}` })),
)
const fields = computed(() => deviceFields(pointOptions.value))
const { model, errors, submitError, pending, reset, mergeIssues, run } = useFormModel(() => fields.value)

function str(key: string): string {
  return String(model.value[key] ?? '').trim()
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const target = props.device
    if (target === null) {
      reset({
        code: '',
        name: '',
        pointId: props.defaultPointId,
        model: '',
        serial: '',
        rangeMin: '',
        rangeMax: '',
        unit: '',
        nodeId: '',
        gateway: '',
        mountPosition: '',
        direction: '',
        health: 'unknown',
        installDate: todayInput(),
        calibratedAt: '',
        remark: '',
      })
      syncFromPoint(true)
      refreshCode()
      return
    }
    reset({
      code: target.code,
      name: target.name,
      pointId: target.pointId,
      model: target.model,
      serial: target.serial,
      rangeMin: target.rangeMin ?? '',
      rangeMax: target.rangeMax ?? '',
      unit: target.unit,
      nodeId: target.nodeId,
      gateway: target.gateway,
      mountPosition: target.mountPosition,
      direction: target.direction,
      health: target.health,
      installDate: target.installDate,
      calibratedAt: target.calibratedAt,
      remark: target.remark,
    })
  },
)

/** 切换测点时只带出默认单位；设备名称由人工填写，不自动拼凑。 */
function syncFromPoint(force: boolean): void {
  const point = archive.pointById(String(model.value.pointId ?? ''))
  if (point === undefined) return
  if (force || str('unit') === '') model.value.unit = metricDef(point.metric).unit
}

function refreshCode(): void {
  if (props.device !== null) return
  const code = suggestDeviceCode(String(model.value.pointId ?? ''))
  if (code !== '') model.value.code = code
}

watch(() => model.value.pointId, () => {
  syncFromPoint(false)
  refreshCode()
})

function buildDraft(): DeviceDraft {
  return {
    code: str('code'),
    name: str('name'),
    pointId: str('pointId'),
    model: str('model'),
    serial: str('serial'),
    rangeMin: parseNum(String(model.value.rangeMin ?? '')),
    rangeMax: parseNum(String(model.value.rangeMax ?? '')),
    unit: str('unit'),
    nodeId: str('nodeId'),
    gateway: str('gateway'),
    mountPosition: str('mountPosition'),
    direction: str('direction'),
    health: String(model.value.health ?? 'unknown') as DeviceHealth,
    installDate: str('installDate'),
    calibratedAt: str('calibratedAt'),
    remark: String(model.value.remark ?? '').trim(),
  }
}

async function submit(): Promise<void> {
  if (!mergeIssues([])) return
  const draft = buildDraft()
  const duplicate = archive.devices.find((row) => row.code === draft.code && row.id !== props.device?.id)
  const extra: ValidationIssue[] = []
  if (duplicate !== undefined) extra.push({ field: 'code', message: `设备编号 ${draft.code} 已存在` })
  if (extra.length > 0) {
    mergeIssues(extra)
    return
  }
  let savedId = ''
  const ok = await run(async () => {
    const row = await saveDevice(props.device?.id ?? null, draft)
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
    :title="device === null ? '登记设备' : `编辑设备 · ${device.code}`"
    sub="设备绑定测点后，其读数与位置档案一并归入该测点历史"
    :width="760"
    @close="emit('close')"
  >
    <FormGrid v-model="model" :fields="fields" :errors="errors" />
    <p v-if="submitError !== ''" class="notice notice--warn submit-error">保存失败：{{ submitError }}</p>
    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton variant="primary" :loading="pending" @click="submit">保存设备</AppButton>
    </template>
  </AppModal>
</template>

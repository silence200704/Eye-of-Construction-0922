<script setup lang="ts">
/** 测点与设备档案面板：建档、编辑、基准设置与归档（有历史记录只归档不删除）。 */
import { computed, ref } from 'vue'
import type { Device, Point } from '@/types/domain'
import { DEVICE_HEALTH_OPTIONS, hasNumericReadings, pointTypeDef } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { setArchived, type ArchiveTarget } from '@/stores/writes/archiveActions'
import { useRecordsStore } from '@/stores/records'
import { fillGaps } from '@/core/format'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import PointDialog from '@/components/dialogs/PointDialog.vue'
import DeviceDialog from '@/components/dialogs/DeviceDialog.vue'
import BaselineDialog from '@/components/dialogs/BaselineDialog.vue'
import ArchiveDialog from '@/components/dialogs/ArchiveDialog.vue'

const props = defineProps<{ buildingId: string; floorId: string | null }>()

const archive = useArchiveStore()
const records = useRecordsStore()

const includeArchived = ref(false)
const message = ref('')
const messageTone = ref<'ok' | 'bad'>('ok')

const pointOpen = ref(false)
const pointEditing = ref<Point | null>(null)
const deviceOpen = ref(false)
const deviceEditing = ref<Device | null>(null)
const deviceOwnerPoint = ref('')
const baselinePoint = ref<Point | null>(null)
const archiveTarget = ref<{ target: ArchiveTarget; id: string; label: string } | null>(null)

const points = computed(() =>
  props.floorId === null
    ? archive.pointsOfBuilding(props.buildingId, includeArchived.value)
    : archive.pointsOfFloor(props.floorId, includeArchived.value),
)

const devices = computed(() => points.value.flatMap((point) => archive.devicesOfPoint(point.id, includeArchived.value)))

function notify(text: string, tone: 'ok' | 'bad'): void {
  message.value = text
  messageTone.value = tone
}

function openPoint(point: Point | null): void {
  pointEditing.value = point
  pointOpen.value = true
}

function openDevice(device: Device | null, pointId = ''): void {
  deviceEditing.value = device
  deviceOwnerPoint.value = device?.pointId ?? pointId
  deviceOpen.value = true
}

function askArchive(target: ArchiveTarget, id: string, label: string): void {
  archiveTarget.value = { target, id, label }
}

async function confirmArchive(reason: string): Promise<void> {
  const target = archiveTarget.value
  if (target === null) return
  const archived = currentArchived(target)
  const result = await setArchived(target.target, target.id, !archived, reason)
  notify(result.message === '' ? '操作完成' : result.message, result.ok ? 'ok' : 'bad')
  archiveTarget.value = null
}

function currentArchived(target: { target: ArchiveTarget; id: string }): boolean {
  if (target.target === 'point') return archive.pointById(target.id)?.status === 'archived'
  if (target.target === 'device') return archive.deviceById(target.id)?.status === 'archived'
  return false
}

function baselineVersion(point: Point): string {
  if (!hasNumericReadings(point.metric)) return '不适用'
  const baseline = archive.currentBaseline(point.id)
  return baseline === undefined ? '未设置' : `v${baseline.version}`
}

function deviceHealthLabel(device: Device): string {
  return DEVICE_HEALTH_OPTIONS.find((item) => item.value === device.health)?.label ?? device.health
}

function healthTone(device: Device): 'gray' | 'green' | 'orange' {
  if (device.health === 'online') return 'green'
  if (device.health === 'offline') return 'orange'
  return 'gray'
}
</script>

<template>
  <div class="stack">
    <p v-if="message !== ''" class="notice" :class="messageTone === 'ok' ? 'notice--brand' : 'notice--warn'">
      {{ message }}
    </p>

    <SectionCard
      title="测点档案"
      :sub="floorId === null ? '该楼栋全部测点' : '当前楼层测点；可在楼层图上核对落点位置'"
    >
      <template #actions>
        <label class="toggle">
          <input v-model="includeArchived" type="checkbox" />
          含已归档
        </label>
        <AppButton size="sm" variant="primary" @click="openPoint(null)">新建测点</AppButton>
      </template>

      <DataTable
        :columns="[
          { key: 'code', label: '测点编号', width: '148px' },
          { key: 'name', label: '名称' },
          { key: 'owner', label: '责任人', width: '104px' },
          { key: 'baseline', label: '基准', width: '80px' },
          { key: 'records', label: '记录', width: '52px', align: 'right' },
          { key: 'status', label: '状态', width: '72px' },
          { key: 'ops', label: '操作', width: '136px' },
        ]"
        :row-count="points.length"
        empty="暂无测点，请先新建测点并设置基准值"
      >
        <tr v-for="point in points" :key="point.id">
          <td class="code">{{ point.code }}</td>
          <td class="col-main">
            <div>{{ point.name }}</div>
            <div class="code">{{ pointTypeDef(point.type).name }}｜{{ fillGaps(point.zoneId) }}</div>
          </td>
          <td>{{ fillGaps(point.owner) }}</td>
          <td class="num">{{ baselineVersion(point) }}</td>
          <td class="ta-r num">{{ hasNumericReadings(point.metric) ? records.countOfPoint(point.id) : '—' }}</td>
          <td>
            <StatusTag :tone="point.status === 'active' ? 'green' : 'gray'" :text="point.status === 'active' ? '在册' : '已归档'" />
          </td>
          <td>
            <div class="ops">
              <AppButton v-if="hasNumericReadings(point.metric)" size="sm" variant="ghost" @click="baselinePoint = point">基准</AppButton>
              <AppButton size="sm" variant="ghost" @click="openPoint(point)">编辑</AppButton>
              <AppButton
                size="sm"
                variant="ghost"
                @click="askArchive('point', point.id, `${point.code} ${point.name}`)"
              >
                {{ point.status === 'active' ? '归档' : '恢复' }}
              </AppButton>
            </div>
          </td>
        </tr>
      </DataTable>
    </SectionCard>

    <SectionCard title="设备档案" sub="设备绑定测点后，其读数与位置档案一并归入该测点历史">
      <template #actions>
        <AppButton size="sm" :disabled="points.length === 0" @click="openDevice(null, points[0]?.id ?? '')">
          登记设备
        </AppButton>
      </template>

      <DataTable
        :columns="[
          { key: 'code', label: '设备编号', width: '180px' },
          { key: 'name', label: '名称 / 型号' },
          { key: 'point', label: '绑定测点', width: '146px' },
          { key: 'range', label: '量程 / 单位', width: '132px' },
          { key: 'health', label: '状态', width: '88px' },
          { key: 'ops', label: '操作', width: '132px' },
        ]"
        :row-count="devices.length"
        empty="暂无设备记录"
      >
        <tr v-for="device in devices" :key="device.id">
          <td class="code">{{ device.code }}</td>
          <td class="col-main">
            <div>{{ device.name }}</div>
            <div class="code">{{ fillGaps(device.model) }}<span v-if="device.serial">｜{{ device.serial }}</span></div>
          </td>
          <td class="code">{{ archive.pointById(device.pointId)?.code ?? '—' }}</td>
          <td>{{ fillGaps(device.rangeText) }}<span v-if="device.unit" class="muted"> / {{ device.unit }}</span></td>
          <td><StatusTag :tone="healthTone(device)" :text="deviceHealthLabel(device)" /></td>
          <td>
            <div class="ops">
              <AppButton size="sm" variant="ghost" @click="openDevice(device)">编辑</AppButton>
              <AppButton size="sm" variant="ghost" @click="askArchive('device', device.id, `${device.code} ${device.name}`)">
                {{ device.status === 'active' ? '归档' : '恢复' }}
              </AppButton>
            </div>
          </td>
        </tr>
      </DataTable>
    </SectionCard>

    <PointDialog
      :open="pointOpen"
      :point="pointEditing"
      :default-building-id="buildingId"
      @close="pointOpen = false"
      @saved="notify('测点档案已保存', 'ok')"
    />
    <DeviceDialog
      :open="deviceOpen"
      :device="deviceEditing"
      :default-point-id="deviceOwnerPoint"
      @close="deviceOpen = false"
      @saved="notify('设备档案已保存', 'ok')"
    />
    <BaselineDialog
      :open="baselinePoint !== null"
      :point="baselinePoint"
      @close="baselinePoint = null"
      @saved="notify('基准值已更新，历史版本保留', 'ok')"
    />
    <ArchiveDialog
      :open="archiveTarget !== null"
      :target-label="archiveTarget?.label ?? ''"
      :archived="archiveTarget !== null && !currentArchived(archiveTarget)"
      @close="archiveTarget = null"
      @confirm="confirmArchive"
    />
  </div>
</template>

<style scoped>
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}

.ops {
  display: flex;
  gap: 2px;
}
</style>

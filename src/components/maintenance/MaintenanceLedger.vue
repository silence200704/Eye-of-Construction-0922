<script setup lang="ts">
/**
 * 保养台账：按设备看"当前计划 / 下次保养日期 / 最近一次结果 / 历史次数"，
 * 点开某台设备可回看它的历史保养记录与现场照片。
 *
 * 台账只读 —— 照片与记录都从库里取（附件按 `maintenanceTaskId` 归属），
 * 页面上没有任何修改或删除保养记录的入口：记录是现场留下的证据，不该在台账里被改写。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { statusLabelOf } from '@/api/contract/states'
import type { MaintenanceDataInput } from '@/core/maintenance/board'
import { maintenanceLedger, maintenanceRecordsOf, maintenanceTaskState, summarizeText } from '@/core/maintenance/board'
import type { IssueAttachment } from '@/types/inspection'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { useArchiveStore } from '@/stores/archive'
import { formatDateTime } from '@/core/time'
import AppDrawer from '@/components/ui/overlay/AppDrawer.vue'
import AppModal from '@/components/ui/AppModal.vue'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const props = defineProps<{ input: MaintenanceDataInput }>()

const attachments = useAttachmentStore()
const archive = useArchiveStore()

const openDeviceId = ref('')
const zoom = ref<{ url: string; fileName: string } | null>(null)
const urlMap = ref<Record<string, { thumb: string; full: string }>>({})

const rows = computed(() => maintenanceLedger(props.input))
/** 没有保养数据的在册设备台数：台账不列它们，但要说清楚少了多少台，避免看起来像数据丢了 */
const uncovered = computed(() => {
  const covered = new Set(rows.value.map((row) => row.deviceId))
  return props.input.devices.filter((row) => row.status === 'active' && !covered.has(row.id)).length
})
const openDevice = computed(() => (openDeviceId.value === '' ? undefined : props.input.devices.find((row) => row.id === openDeviceId.value)))
const records = computed(() => (openDeviceId.value === '' ? [] : maintenanceRecordsOf(props.input.tasks, openDeviceId.value)))
const devicePhotos = computed(() => records.value.flatMap((task) => attachments.attachments.filter((row) => row.maintenanceTaskId === task.id)))

/**
 * 缩略图与大图的对象 URL：建立与释放都放在 watch 里（computed 会被重复求值，不能在里头做副作用）。
 * 容忍损坏的附件行（早期版本写过 blob 为 `{}` 的照片），否则一行坏数据会让整抽屉渲染不出来。
 */
watch(
  () => devicePhotos.value.map((row) => row.id).join('|'),
  () => {
    const next: Record<string, { thumb: string; full: string }> = {}
    for (const row of devicePhotos.value) {
      const existing = urlMap.value[row.id]
      if (existing !== undefined) {
        next[row.id] = existing
        continue
      }
      // 损坏的附件行（例如早期版本写过 blob 为 `{}` 的照片）不给 URL，由模板显示占位提示
      if (row.thumb instanceof Blob && row.blob instanceof Blob) {
        next[row.id] = { thumb: URL.createObjectURL(row.thumb), full: URL.createObjectURL(row.blob) }
      }
    }
    for (const [id, entry] of Object.entries(urlMap.value)) {
      if (next[id] === undefined) {
        URL.revokeObjectURL(entry.thumb)
        URL.revokeObjectURL(entry.full)
      }
    }
    urlMap.value = next
  },
  { immediate: true },
)

onUnmounted(() => {
  for (const entry of Object.values(urlMap.value)) {
    URL.revokeObjectURL(entry.thumb)
    URL.revokeObjectURL(entry.full)
  }
})

function photosOf(taskId: string): IssueAttachment[] {
  return devicePhotos.value.filter((row) => row.maintenanceTaskId === taskId)
}

function thumbOf(photoId: string): string {
  return urlMap.value[photoId]?.thumb ?? ''
}

function zoomPhoto(row: IssueAttachment): void {
  const entry = urlMap.value[row.id]
  if (entry === undefined) return
  zoom.value = { url: entry.full, fileName: row.fileName }
}

function planTextOf(index: number): string {
  const plan = rows.value[index]?.plan
  if (plan === null || plan === undefined) return '暂无保养计划'
  return `${plan.code}｜${plan.name}｜负责人 ${plan.owner || '待补充'}`
}

function nextDueText(index: number): string {
  const row = rows.value[index]
  if (row === undefined || row.nextDueDate === null) return '暂无下次保养日期'
  return row.nextDueSource === 'execution' ? `${row.nextDueDate}（现场登记）` : `${row.nextDueDate}（按周期推算）`
}

function lastResultText(index: number): string {
  const last = rows.value[index]?.lastResult
  if (last === null || last === undefined) return '暂无保养记录'
  return `${formatDateTime(last.at)}｜${last.by}｜照片 ${last.photoCount} 张`
}
</script>

<template>
  <div class="ledger">
    <div class="row-between actions">
      <span class="muted">
        台账按设备列出保养情况（共 {{ rows.length }} 台）；照片与记录只读，来自保养任务的执行留痕
      </span>
      <span class="muted">
        另有 {{ uncovered }} 台在册设备暂无保养计划或保养记录（未列入台账）
      </span>
    </div>

    <DataTable
      :columns="[
        { key: 'device', label: '设备编号', width: '170px' },
        { key: 'name', label: '设备 / 位置' },
        { key: 'plan', label: '当前计划', width: '250px' },
        { key: 'due', label: '下次保养日期', width: '170px' },
        { key: 'last', label: '最近一次保养结果', width: '250px' },
        { key: 'count', label: '历史次数', width: '110px' },
        { key: 'act', label: '操作', width: '86px' },
      ]"
      :row-count="rows.length"
      empty="还没有保养台账：先在工作台新建保养计划并生成任务，执行后的记录会汇总到这里"
    >
      <tr v-for="(row, index) in rows" :key="row.deviceId">
        <td class="mono">{{ row.deviceCode }}</td>
        <td>
          <b>{{ row.deviceName }}</b>
          <div class="muted">{{ archive.pointLabel(archive.deviceById(row.deviceId)?.pointId ?? '') }}</div>
        </td>
        <td>
          {{ planTextOf(index) }}
          <div v-if="row.planCount > 1" class="muted">共 {{ row.planCount }} 个计划，其中启用 {{ row.activePlanCount }} 个</div>
        </td>
        <td class="mono">{{ nextDueText(index) }}</td>
        <td>
          <template v-if="row.lastResult !== null">
            <div>{{ lastResultText(index) }}</div>
            <div class="muted">{{ summarizeText(row.lastResult.measures, 22) || '（未填写措施）' }}</div>
          </template>
          <span v-else class="muted">暂无保养记录</span>
        </td>
        <td class="num">
          {{ row.doneCount }} 次
          <div v-if="row.pendingCount > 0" class="muted">待执行 {{ row.pendingCount }} 条<template v-if="row.overdueCount > 0">（逾期 {{ row.overdueCount }}）</template></div>
        </td>
        <td>
          <button class="link" type="button" @click="openDeviceId = row.deviceId">查看记录</button>
        </td>
      </tr>
    </DataTable>

    <AppDrawer
      :open="openDevice !== undefined"
      :title="openDevice === undefined ? '' : `${openDevice.code} ${openDevice.name}`"
      sub="保养历史记录与现场照片（只读）"
      :width="620"
      @close="openDeviceId = ''"
    >
      <div v-if="records.length === 0" class="muted">该设备暂无保养记录。</div>
      <div v-else class="records">
        <div v-for="task in records" :key="task.id" class="record">
          <div class="row-between">
            <b class="mono">{{ task.taskNo }}</b>
            <StatusTag :tone="maintenanceTaskState(task, input.todayKey, input.now).tone" :text="maintenanceTaskState(task, input.todayKey, input.now).label" />
          </div>
          <div class="muted">
            {{ task.snapshot.planCode }}｜计划执行时刻 {{ formatDateTime(task.plannedAt) }}｜负责人 {{ task.snapshot.owner || '待补充' }}
          </div>

          <template v-if="task.execution !== null">
            <div class="muted">
              实际执行 {{ formatDateTime(task.execution.at) }}｜{{ task.execution.by }}（{{ task.execution.byRole }}）｜下次保养 {{ task.execution.nextDueDate }}
            </div>
            <p class="text">维护措施：{{ task.execution.measures }}</p>
            <p v-if="task.execution.materials !== ''" class="text">更换材料：{{ task.execution.materials }}</p>
            <p v-if="task.execution.note !== ''" class="text">备注：{{ task.execution.note }}</p>
            <ul class="items">
              <li v-for="answer in task.execution.checklist" :key="answer.key">
                <StatusTag :tone="answer.result === 'abnormal' ? 'orange' : 'green'" :text="answer.result === 'abnormal' ? '异常' : '正常'" />
                <span>{{ answer.label }}</span>
                <span v-if="answer.note !== ''" class="muted">{{ answer.note }}</span>
              </li>
            </ul>

            <div v-if="photosOf(task.id).length > 0" class="photos">
              <figure v-for="photo in photosOf(task.id)" :key="photo.id" class="thumb">
                <button type="button" class="thumb-btn" @click="zoomPhoto(photo)">
                  <img v-if="thumbOf(photo.id) !== ''" :src="thumbOf(photo.id)" :alt="photo.fileName" />
                  <span v-else class="thumb-broken">照片数据已损坏</span>
                </button>
                <figcaption>{{ photo.fileName }}<span class="muted">点击看大图</span></figcaption>
              </figure>
            </div>
            <p v-else class="muted">本次没有上传现场照片。</p>
          </template>
          <p v-else class="muted">该周期尚未执行（{{ statusLabelOf('maintenance',task.status) }}），没有执行记录与照片。</p>
        </div>
      </div>
    </AppDrawer>

    <AppModal :open="zoom !== null" :title="zoom?.fileName ?? '现场照片'" sub="保养留痕照片（压缩图，原始大图不入库）" :width="720" @close="zoom = null">
      <img v-if="zoom !== null" class="zoom" :src="zoom.url" :alt="zoom.fileName" />
    </AppModal>
  </div>
</template>

<style scoped>
.ledger {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.actions {
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.records {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.record {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--paper);
  font-size: 12px;
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.items li {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.text {
  margin: 0;
  line-height: 1.6;
}

.photos {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
}

.thumb {
  width: 132px;
  margin: 0;
}

.thumb-btn {
  display: block;
  width: 100%;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  cursor: zoom-in;
}

.thumb img {
  width: 100%;
  height: 88px;
  object-fit: cover;
  border-radius: 3px;
  display: block;
}

.thumb-broken {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88px;
  font-size: 11px;
  color: var(--state-red, #c0362c);
  background: var(--canvas);
  border-radius: 3px;
}

.thumb figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.zoom {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--r-sm);
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

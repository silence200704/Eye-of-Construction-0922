<script setup lang="ts">
/** 监测数据：单条录入、条件查询、记录详情与修订留痕。 */
import { computed, ref } from 'vue'
import type { MetricValues, MonitorRecord } from '@/types/domain'
import { QUALITY_OPTIONS, metricDef, qualityLabel, recordSourceLabel } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { levelOfRecord, stateLabel, stateTone } from '@/core/rules'
import { fmtDelta, fmtNumber } from '@/core/format'
import { formatDateTime, nowIso } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import RecordDialog from '@/components/dialogs/RecordDialog.vue'
import RecordDetailDialog from '@/components/panels/RecordDetailDialog.vue'
import ImportPanel from '@/components/panels/ImportPanel.vue'

const archive = useArchiveStore()
const records = useRecordsStore()

const PAGE_SIZE = 20

const filterBuilding = ref('')
const filterFloor = ref('')
const filterPoint = ref('')
const filterQuality = ref('')
const keyword = ref('')
const page = ref(1)

const recordOpen = ref(false)
const editingRecord = ref<MonitorRecord | null>(null)
const detailRecordId = ref('')
const detailOpen = ref(false)

const buildingOptions = computed(() => archive.activeBuildings.map((row) => ({ value: row.id, label: row.name })))
const floorOptions = computed(() => {
  if (filterBuilding.value === '') return []
  return archive.floorsOf(filterBuilding.value).map((row) => ({ value: row.id, label: row.name }))
})
const pointOptions = computed(() => {
  const list =
    filterFloor.value !== ''
      ? archive.pointsOfFloor(filterFloor.value)
      : filterBuilding.value !== ''
        ? archive.pointsOfBuilding(filterBuilding.value)
        : archive.activePoints
  return list.map((row) => ({ value: row.id, label: `${row.code} ${row.name}` }))
})

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  const pointIds = new Set(pointOptions.value.map((item) => item.value))
  const pointScope = filterPoint.value !== '' ? new Set([filterPoint.value]) : pointIds
  return records.sorted.filter((row) => {
    if (!pointScope.has(row.pointId)) return false
    if (filterQuality.value !== '' && row.quality !== filterQuality.value) return false
    if (text !== '' && !row.recordNo.toLowerCase().includes(text) && !row.note.toLowerCase().includes(text)) return false
    return true
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

const detailRecord = computed(() => records.records.find((row) => row.id === detailRecordId.value) ?? undefined)

function readText(values: MetricValues, metricKey: MonitorRecord['metric']): string {
  const def = metricDef(metricKey)
  return def.fields.map((field) => `${fmtNumber(values[field.key] ?? null, field.digits)}${field.unit}`).join(' / ')
}

function deltaText(record: MonitorRecord): string {
  const list = metricDef(record.metric).deltas(record.values, record.baselineValues)
  if (list.length === 0) return '—'
  return list.map((item) => `${fmtDelta(item.value, item.digits)}${item.unit}`).join(' ')
}

function pointName(pointId: string): string {
  const point = archive.pointById(pointId)
  return point === undefined ? '未知测点' : `${point.code} ${point.name}`
}

function openRecord(pointId: string | null, record: MonitorRecord | null): void {
  editingRecord.value = record
  filterPoint.value = filterPoint.value === '' && pointId !== null ? pointId : filterPoint.value
  recordOpen.value = true
}

function openDetail(record: MonitorRecord): void {
  detailRecordId.value = record.id
  detailOpen.value = true
}

function resetFilters(): void {
  filterBuilding.value = ''
  filterFloor.value = ''
  filterPoint.value = ''
  filterQuality.value = ''
  keyword.value = ''
  page.value = 1
}

/** 数值分级：只看绝对值或相对基准变化量，用于列表快速标注。 */
function levelOfRow(record: MonitorRecord): { text: string; tone: 'gray' | 'green' | 'yellow' | 'orange' | 'red' | 'brand' } | null {
  const rule = archive.ruleFor(record.pointId, record.sampleTime)
  if (rule === undefined) return null
  const state = levelOfRecord(rule, record)
  return state === null ? null : { text: stateLabel(state), tone: stateTone(state) }
}

function qualityTone(record: MonitorRecord): 'green' | 'orange' | 'red' {
  if (record.quality === 'valid') return 'green'
  return record.quality === 'suspect' ? 'orange' : 'red'
}

</script>

<template>
  <div class="stack">
    <p v-if="records.lastEventMessage !== ''" class="notice notice--brand">
      <b>上一条记录的预警结果：</b>{{ records.lastEventMessage }}
      <RouterLink class="link" to="/alarms">到预警中心查看</RouterLink>
    </p>

    <SectionCard title="录入与查询" sub="采样时间与录入时间分别保存；缺项不按零处理，重复时间不允许静默覆盖" marked>
      <template #actions>
        <AppButton size="sm" variant="primary" @click="openRecord(null, null)">录入监测数据</AppButton>
      </template>

      <div class="filters">
        <label class="filter">
          <span>楼栋</span>
          <select
            v-model="filterBuilding"
            class="ctl"
            @change="
              () => {
                filterFloor = ''
                filterPoint = ''
                page = 1
              }
            "
          >
            <option value="">全部</option>
            <option v-for="item in buildingOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="filter">
          <span>楼层</span>
          <select
            v-model="filterFloor"
            class="ctl"
            :disabled="filterBuilding === ''"
            @change="
              () => {
                filterPoint = ''
                page = 1
              }
            "
          >
            <option value="">全部</option>
            <option v-for="item in floorOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="filter">
          <span>测点</span>
          <select v-model="filterPoint" class="ctl" @change="page = 1">
            <option value="">全部</option>
            <option v-for="item in pointOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="filter">
          <span>质量</span>
          <select v-model="filterQuality" class="ctl" @change="page = 1">
            <option value="">全部</option>
            <option v-for="item in QUALITY_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="filter filter--wide">
          <span>关键词</span>
          <input v-model="keyword" class="ctl" type="search" placeholder="记录编号或备注" @input="page = 1" />
        </label>
        <AppButton size="sm" @click="resetFilters">重置</AppButton>
      </div>

      <div class="counts">
        <span>筛选结果 <b class="num">{{ filtered.length }}</b> 条</span>
        <span class="muted">全部记录 <b class="num">{{ records.total }}</b></span>
        <span class="muted">存疑或无效 <b class="num">{{ records.suspectCount }}</b></span>
        <span class="muted">已修订 <b class="num">{{ records.revisedCount }}</b></span>
      </div>
    </SectionCard>

    <SectionCard title="历史记录" sub="点击行查看完整记录与修订历史">
      <DataTable
        :columns="[
          { key: 'no', label: '记录编号', width: '140px' },
          { key: 'time', label: '采样时间', width: '140px' },
          { key: 'point', label: '测点' },
          { key: 'value', label: '读数', align: 'right' },
          { key: 'delta', label: '变化量', align: 'right', width: '130px' },
          { key: 'level', label: '数值分级', width: '126px' },
          { key: 'quality', label: '质量', width: '110px' },
          { key: 'entered', label: '录入人', width: '150px' },
          { key: 'ops', label: '操作', width: '110px' },
        ]"
        :row-count="pageRows.length"
        empty="没有符合条件的记录"
      >
        <tr v-for="record in pageRows" :key="record.id" class="clickable" @click="openDetail(record)">
          <td class="code">{{ record.recordNo }}</td>
          <td class="num">{{ formatDateTime(record.sampleTime) }}</td>
          <td>
            <div>{{ pointName(record.pointId) }}</div>
            <div class="code">
              {{ recordSourceLabel(record, nowIso()) }}{{ record.isBackfill ? '｜历史补录' : ''
              }}{{ record.revision > 0 ? `｜已修订 ${record.revision} 次` : '' }}
            </div>
          </td>
          <td class="ta-r num">{{ readText(record.values, record.metric) }}</td>
          <td class="ta-r num">{{ deltaText(record) }}</td>
          <td>
            <StatusTag
              v-if="levelOfRow(record) !== null"
              :tone="levelOfRow(record)!.tone"
              :text="levelOfRow(record)!.text"
            />
            <span v-else class="muted">无适用规则</span>
          </td>
          <td><StatusTag :tone="qualityTone(record)" :text="qualityLabel(record.quality)" /></td>
          <td>{{ record.enteredBy }}</td>
          <td>
            <AppButton size="sm" variant="ghost" @click.stop="openRecord(record.pointId, record)">修订</AppButton>
          </td>
        </tr>
      </DataTable>

      <div class="pager">
        <AppButton size="sm" :disabled="page <= 1" @click="page -= 1">上一页</AppButton>
        <span class="muted">第 {{ page }} / {{ totalPages }} 页</span>
        <AppButton size="sm" :disabled="page >= totalPages" @click="page += 1">下一页</AppButton>
      </div>
    </SectionCard>

    <ImportPanel />

    <EmptyState
      v-if="records.total === 0"
      title="尚无监测记录"
      sub="先建立楼栋与测点，再录入第一条数据；录入手动数据不会自动构成设备在线证据"
    />

    <RecordDialog
      :open="recordOpen"
      :point-id="editingRecord === null ? (filterPoint === '' ? null : filterPoint) : null"
      :record="editingRecord"
      @close="recordOpen = false"
    />

    <RecordDetailDialog
      :open="detailOpen"
      :record="detailRecord"
      @close="detailOpen = false"
      @revise="
        (row) => {
          detailOpen = false
          openRecord(row.pointId, row)
        }
      "
    />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}

.filter {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
  min-width: 150px;
}

.filter--wide {
  flex: 1;
  min-width: 220px;
}

.counts {
  display: flex;
  gap: 18px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 12.5px;
  color: var(--text-2);
}

.clickable {
  cursor: pointer;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 12px;
  font-size: 12.5px;
}

</style>

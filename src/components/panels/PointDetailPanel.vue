<script setup lang="ts">
/** 点位详情面板：档案、当前基准与历史版本、绑定设备、最近记录。 */
import { computed } from 'vue'
import type { Point } from '@/types/domain'
import { METRICS, hasNumericReadings, metricDef, pointTypeDef, qualityLabel, sourceLabel } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { levelOfRecord, stateLabel, stateTone } from '@/core/rules'
import { fillGaps, fmtDelta, fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import DescList from '@/components/ui/info/DescList.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{ point: Point | null }>()
const emit = defineEmits<{ record: [pointId: string]; baseline: [pointId: string] }>()

const archive = useArchiveStore()
const records = useRecordsStore()

const metric = computed(() => (props.point === null ? METRICS[0] : metricDef(props.point.metric)))
/** 人工检查点不产生数值记录，也不设基准。 */
const numeric = computed(() => (props.point === null ? true : hasNumericReadings(props.point.metric)))
const locationHistory = computed(() => (props.point === null ? [] : [...props.point.locationHistory].reverse()))
const baseline = computed(() => (props.point === null ? undefined : archive.currentBaseline(props.point.id)))
const baselineHistory = computed(() => (props.point === null ? [] : archive.baselineHistory(props.point.id)))
const devices = computed(() => (props.point === null ? [] : archive.devicesOfPoint(props.point.id)))
const recent = computed(() => {
  if (props.point === null) return []
  return records.ofPoint(props.point.id).slice(-6).reverse()
})

function buildingLabel(point: Point): string {
  const building = archive.buildingById(point.buildingId)
  const floor = archive.floorById(point.floorId)
  return `${building?.name ?? '未知楼栋'} ${floor?.name ?? ''}`.trim()
}

function baselineText(): string {
  if (!numeric.value) return '该点位不产生数值记录，不设基准'
  const current = baseline.value
  if (current === undefined) return '尚未设置'
  return metric.value.baselineFields
    .map((field) => {
      const value = current.values[field.key]
      return `${field.label} ${fmtNumber(value ?? null, field.digits)}${field.unit}`
    })
    .join('　')
}

function levelOfRecordRow(recordId: string): { text: string; tone: 'gray' | 'green' | 'yellow' | 'orange' | 'red' | 'brand' } | null {
  const record = records.records.find((row) => row.id === recordId)
  if (record === undefined) return null
  const rule = archive.ruleFor(record.pointId, record.sampleTime)
  if (rule === undefined) return null
  const state = levelOfRecord(rule, record)
  return state === null ? null : { text: stateLabel(state), tone: stateTone(state) }
}

function deltaText(recordId: string): string {
  const record = records.records.find((row) => row.id === recordId)
  if (record === undefined) return '—'
  const list = metric.value.deltas(record.values, record.baselineValues)
  if (list.length === 0) return '—'
  return list.map((item) => `${fmtDelta(item.value, item.digits)}${item.unit}`).join(' ')
}

const infoItems = computed(() => {
  const point = props.point
  if (point === null) return []
  return [
    { label: '点位编号', value: point.code, mono: true },
    { label: '测点类型', value: pointTypeDef(point.type).name },
    { label: '所属位置', value: buildingLabel(point) },
    { label: '所在区域', value: fillGaps(point.zoneId) },
    { label: '点位责任人', value: fillGaps(point.owner) },
    { label: '替补人员', value: fillGaps(point.backupPerson) },
    { label: '安装日期', value: fillGaps(point.installDate), mono: true },
    { label: '底图版本', value: `v${point.planVersion}`, mono: true },
    {
      label: '图上坐标',
      value: `X ${point.coord.x.toFixed(3)} / Y ${point.coord.y.toFixed(3)}`,
      mono: true,
    },
    { label: '位置变更', value: point.locationHistory.length === 0 ? '建档后未移动' : `已变更 ${point.locationHistory.length} 次` },
    { label: '数据性质', value: point.dataSource === 'real' ? '实测建档' : '示例数据' },
  ]
})
</script>

<template>
  <SectionCard title="点位详情" :sub="point === null ? '在楼层图上选择测点查看档案' : point.name">
    <template #actions>
      <template v-if="point !== null">
        <AppButton v-if="numeric" size="sm" @click="emit('baseline', point.id)">基准值</AppButton>
        <AppButton v-if="numeric" size="sm" variant="primary" @click="emit('record', point.id)">录入数据</AppButton>
      </template>
    </template>

    <EmptyState v-if="point === null" title="尚未选择测点" sub="点击楼层图上的测点标记，或从下方列表选择" />

    <div v-else class="stack">
      <div class="row wrap">
        <StatusTag tone="brand" :text="pointTypeDef(point.type).name" :dot="false" />
        <StatusTag
          :tone="point.dataSource === 'real' ? 'green' : 'gray'"
          :text="point.dataSource === 'real' ? '实测建档' : '示例数据'"
        />
        <StatusTag v-if="point.status === 'archived'" tone="gray" text="已归档" />
        <span class="code">{{ point.code }}</span>
      </div>

      <DescList :items="infoItems" />

      <div v-if="numeric" class="block">
        <div class="block-head">
          <span class="block-title">当前基准</span>
          <StatusTag v-if="baseline !== undefined" tone="brand" :text="`v${baseline.version}`" :dot="false" />
        </div>
        <p class="baseline-text">{{ baselineText() }}</p>
        <p v-if="baseline !== undefined" class="field-hint">生效时间 {{ formatDateTime(baseline.effectiveFrom) }}｜原因：{{ baseline.reason }}</p>
        <p v-else class="field-hint">{{ metric.baselineNote }}</p>
        <details v-if="baselineHistory.length > 1" class="history">
          <summary>历史基准版本（{{ baselineHistory.length }}）</summary>
          <ul class="his-list">
            <li v-for="item in baselineHistory" :key="item.id">
              <span class="code">v{{ item.version }}</span>
              <span>{{ formatDateTime(item.effectiveFrom) }}</span>
              <span class="muted">{{ item.createdBy }}</span>
              <span class="muted">{{ item.reason }}</span>
            </li>
          </ul>
        </details>
      </div>

      <div v-if="locationHistory.length > 0" class="block">
        <div class="block-head">
          <span class="block-title">位置变更历史</span>
          <span class="muted">{{ locationHistory.length }} 次</span>
        </div>
        <ul class="his-list">
          <li v-for="(change, index) in locationHistory" :key="index">
            <span class="code">{{ formatDateTime(change.at) }}</span>
            <span>{{ change.by }} · {{ change.role }}</span>
            <span class="muted">
              {{ change.from.zoneId }} → {{ change.to.zoneId }}（X {{ change.from.coord.x.toFixed(3) }} →
              {{ change.to.coord.x.toFixed(3) }}）
            </span>
            <span class="muted">原因：{{ change.reason }}</span>
          </li>
        </ul>
      </div>

      <div class="block">
        <div class="block-head">
          <span class="block-title">绑定设备</span>
          <span class="muted">{{ devices.length }} 台</span>
        </div>
        <ul v-if="devices.length > 0" class="dev-list">
          <li v-for="device in devices" :key="device.id">
            <span class="code">{{ device.code }}</span>
            <span>{{ device.name }}</span>
            <span class="muted">{{ fillGaps(device.model) }}</span>
          </li>
        </ul>
        <p v-else class="field-hint">该测点尚未登记设备，读数只能以人工录入方式采集。</p>
      </div>

      <div class="block">
        <div class="block-head">
          <span class="block-title">最近记录</span>
          <span class="muted">{{ numeric ? `${records.countOfPoint(point.id)} 条` : '不适用' }}</span>
        </div>
        <p v-if="!numeric" class="field-hint">人工检查点不产生数值记录；检查清单、照片上报与必查点覆盖在后续版本提供。</p>
        <DataTable
          v-if="numeric"
          :columns="[
            { key: 'time', label: '采样时间', width: '148px' },
            { key: 'value', label: '读数' },
            { key: 'delta', label: '变化量' },
            { key: 'level', label: '分级', width: '104px' },
            { key: 'quality', label: '质量', width: '90px' },
          ]"
          :row-count="recent.length"
          empty="该测点尚无监测记录"
        >
          <tr v-for="record in recent" :key="record.id">
            <td class="num">{{ formatDateTime(record.sampleTime) }}</td>
            <td class="num">
              {{
                metric.fields
                  .map((field) => `${fmtNumber(record.values[field.key] ?? null, field.digits)}${field.unit}`)
                  .join(' / ')
              }}
            </td>
            <td class="num">{{ deltaText(record.id) }}</td>
            <td>
              <StatusTag
                v-if="levelOfRecordRow(record.id) !== null"
                :tone="levelOfRecordRow(record.id)!.tone"
                :text="levelOfRecordRow(record.id)!.text"
              />
              <span v-else class="muted">—</span>
            </td>
            <td>{{ qualityLabel(record.quality) }}</td>
          </tr>
        </DataTable>
        <p v-if="numeric" class="field-hint">
          来源标记：{{ recent.length > 0 ? sourceLabel(recent[0].source) : '—' }}；完整历史与修订见「监测数据」页。
        </p>
      </div>
    </div>
  </SectionCard>
</template>

<style scoped>
.block {
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.block-title {
  font-size: 13px;
  font-weight: 600;
}

.baseline-text {
  font-size: 14px;
  font-family: var(--font-mono);
  color: var(--brand-700);
}

.history {
  margin-top: 10px;
  font-size: 12px;
}

.history summary {
  cursor: pointer;
  color: var(--brand-600);
}

.his-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.his-list li {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 8px;
  background: var(--canvas);
  border-radius: var(--r-sm);
}

.dev-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}

.dev-list li {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
</style>

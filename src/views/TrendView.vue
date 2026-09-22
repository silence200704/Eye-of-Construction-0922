<script setup lang="ts">
/**
 * 监测趋势：单测点、单指标。
 *
 * 不同单位的指标不共轴，因此先选测点（决定指标与单位），再在同类指标内部按字段出图；
 * 温湿度的温度与湿度单位不同，分开两张图。
 */
import { computed, onMounted, ref } from 'vue'
import type { MetricValueKey, MetricValues, Point } from '@/types/domain'
import { metricDef, pointTypeDef } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useRecordsStore } from '@/stores/records'
import { buildTrendSeries, type TrendSeriesSpec } from '@/core/chart/trend'
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import { stateLabel } from '@/core/rules'
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import DescList from '@/components/ui/info/DescList.vue'
import TrendChart from '@/components/charts/TrendChart.vue'

const archive = useArchiveStore()
const records = useRecordsStore()
const events = useEventsStore()

const RANGE_OPTIONS = [
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
  { value: '0', label: '全部' },
]

const pointId = ref('')
const rangeDays = ref('30')
const onlyValid = ref(false)
const selectedRecordId = ref('')

onMounted(() => {
  if (pointId.value === '') {
    const first = archive.activePoints.find((row) => archive.ruleFor(row.id, new Date().toISOString()) !== undefined)
    pointId.value = first?.id ?? ''
  }
})

const point = computed<Point | undefined>(() => archive.pointById(pointId.value))
const def = computed(() => (point.value === undefined ? undefined : metricDef(point.value.metric)))
/** 当前生效的规则：用于页面提示；图上每条记录按自己的采样时间取版本。 */
const rule = computed(() => (point.value === undefined ? undefined : archive.ruleFor(point.value.id, new Date().toISOString())))

const pointRecords = computed(() => (point.value === undefined ? [] : records.ofPoint(point.value.id)))
const pointEvents = computed(() => (point.value === undefined ? [] : events.eventsOfPoint(point.value.id)))

const range = computed(() => {
  /*
   * 上界取当前时刻：采样时间不允许晚于当前时间，没有记录落在未来。
   * 原实现给上界加了一天，横轴因此比"近 30 天"宽出两个多天，标签与刻度对不上。
   */
  const to = Date.now()
  if (rangeDays.value === '0') return { from: 0, to }
  return { from: to - Number(rangeDays.value) * 86_400_000, to }
})

/** 按字段分图：每个字段一列，单位不同的字段天然分开。 */
const seriesList = computed<{ spec: TrendSeriesSpec; series: ReturnType<typeof buildTrendSeries> }[]>(() => {
  const target = point.value
  const metric = def.value
  if (target === undefined || metric === undefined) return []
  return metric.fields.map((field) => {
    const spec: TrendSeriesSpec = {
      key: field.key as MetricValueKey,
      label: field.label,
      unit: field.unit,
      digits: field.digits,
    }
    return {
      spec,
      series: buildTrendSeries({
        point: target,
        records: pointRecords.value,
        baselines: archive.baselines.filter((row) => row.pointId === target.id),
        events: pointEvents.value,
        rules: archive.rules,
        series: spec,
        from: range.value.from,
        to: range.value.to,
      }),
    }
  })
})

const visibleSeries = computed(() =>
  seriesList.value.filter((item) => !onlyValid.value || item.series.points.length + item.series.supersededPoints.length > 0),
)

const selectedRecord = computed(() => pointRecords.value.find((row) => row.id === selectedRecordId.value))
const selectedPoint = computed(() => {
  for (const item of seriesList.value) {
    const found = [...item.series.points, ...item.series.supersededPoints].find((row) => row.recordId === selectedRecordId.value)
    if (found !== undefined) return found
  }
  return null
})
const selectedEvent = computed(() => {
  const eventId = selectedPoint.value?.eventId ?? ''
  return eventId === '' ? undefined : events.byId(eventId)
})
const selectedEventNotifications = computed(() =>
  selectedEvent.value === undefined ? [] : events.notificationsOf(selectedEvent.value.id),
)

const detailItems = computed(() => {
  const record = selectedRecord.value
  if (record === undefined) return []
  return [
    { label: '记录编号', value: record.recordNo, mono: true },
    { label: '采样时间', value: formatDateTime(record.sampleTime), mono: true },
    { label: '读数', value: readText(record.values), mono: true },
    { label: '数值分级', value: selectedPoint.value?.state === null || selectedPoint.value === null ? '—' : stateLabel(selectedPoint.value.state) },
    { label: '基准快照', value: record.baselineVersion === null ? '不设基准' : `v${record.baselineVersion}｜${baselineText(record.baselineValues)}`, mono: record.baselineVersion !== null },
    { label: '数据状态', value: record.isBackfill ? '历史补录' : '常规录入' },
    { label: '修订', value: record.revision === 0 ? '未修订' : `已修订 ${record.revision} 次` },
    { label: '录入人', value: `${record.enteredBy} · ${record.enteredByRole}` },
  ]
})

function readText(values: MetricValues): string {
  const metric = def.value
  if (metric === undefined) return '—'
  return metric.fields
    .map((field) => `${fmtNumber(values[field.key] ?? null, field.digits)}${field.unit}`)
    .join(' / ')
}

function baselineText(values: MetricValues | null): string {
  if (values === null) return '—'
  return Object.entries(values)
    .filter(([, value]) => typeof value === 'number')
    .map(([, value]) => fmtNumber(value as number, 2))
    .join(' / ')
}

function selectRecord(recordId: string): void {
  selectedRecordId.value = recordId
}
</script>

<template>
  <div class="stack">
    <p class="notice notice--warn">
      <b>看图口径：</b>一条数据线 + 基准线（按版本分段）+ 三级阈值线 + 事件节点 + 修订标记。
      不同单位的指标不共轴，请按单测点单指标查看；图上分级与预警中心的事件完全同源。
    </p>

    <SectionCard title="查看条件" sub="选测点后按指标出图" marked>
      <div class="filters">
        <label class="filter filter--wide">
          <span>测点</span>
          <select v-model="pointId" class="ctl">
            <option value="">请选择测点</option>
            <option v-for="item in archive.activePoints" :key="item.id" :value="item.id">
              {{ item.code }} {{ item.name }}
            </option>
          </select>
        </label>
        <label class="filter">
          <span>时间范围</span>
          <select v-model="rangeDays" class="ctl">
            <option v-for="item in RANGE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="toggle">
          <input v-model="onlyValid" type="checkbox" />
          仅看有记录的指标
        </label>
      </div>

      <p v-if="point !== undefined && rule === undefined" class="notice notice--warn">
        该测点没有适用的启用规则，图上只画数据点，不做分级与阈值线。
      </p>
      <p v-else-if="point !== undefined && rule !== undefined" class="field-hint">
        命中规则：{{ rule.code }} {{ rule.name }}（{{ rule.version }}），
        {{ rule.thresholds === null ? '环境条件规则，不适用三级阈值线' : `阈值 黄 ${rule.thresholds.yellow} / 橙 ${rule.thresholds.orange} / 红 ${rule.thresholds.red} ${rule.unit}` }}。
        测点类型：{{ pointTypeDef(point.type).name }}。
      </p>
    </SectionCard>

    <EmptyState v-if="point === undefined" title="尚未选择测点" sub="在上方选择一个测点后查看趋势" />

    <template v-else>
      <SectionCard
        v-for="item in visibleSeries"
        :key="item.spec.key"
        :title="`${point.code}｜${item.spec.label}`"
        :sub="`单位 ${item.spec.unit}｜有效记录 ${item.series.points.length} 条，已被修订替代 ${item.series.supersededPoints.length} 条`"
      >
        <TrendChart
          :series="item.series"
          :active-record-id="selectedRecordId"
          @select="selectRecord"
        />
      </SectionCard>

      <SectionCard
        v-if="selectedRecord !== undefined"
        title="选中的记录"
        :sub="selectedEvent === undefined ? '该记录未触发事件' : `命中事件 ${selectedEvent.eventNo}`"
      >
        <div class="row wrap head-row">
          <StatusTag
            v-if="selectedPoint !== null && selectedPoint.state !== null"
            :tone="selectedPoint.state === 'recovering' ? 'brand' : selectedPoint.state === 'normal' ? 'green' : selectedPoint.state === 'yellow' ? 'yellow' : selectedPoint.state === 'orange' ? 'orange' : 'red'"
            :text="stateLabel(selectedPoint.state)"
          />
          <StatusTag v-if="selectedRecord.isBackfill" tone="gray" text="历史补录" />
          <StatusTag v-if="selectedRecord.revision > 0" tone="orange" :text="`已修订 ${selectedRecord.revision} 次`" />
          <StatusTag v-if="selectedPoint !== null && selectedPoint.eventId === null && selectedPoint.state !== null" tone="gray" text="未计入事件证据" />
        </div>

        <DescList :items="detailItems" :columns="2" />

        <div v-if="selectedEvent !== undefined" class="block">
          <div class="block-title">事件与通知</div>
          <DescList
            :items="[
              { label: '事件编号', value: selectedEvent.eventNo, mono: true },
              { label: '事件等级 / 最高', value: `${selectedEvent.level}｜${selectedEvent.peakLevel}` },
              { label: '事件状态', value: selectedEvent.status },
              { label: '证据 / 升级次数', value: `${selectedEvent.evidences.length} / ${selectedEvent.upgrades.length}` },
              { label: '确认人', value: selectedEvent.acknowledgedBy === '' ? '待确认' : selectedEvent.acknowledgedBy },
              { label: '最近触发', value: formatDateTime(selectedEvent.lastTriggerAt) },
            ]"
            :columns="2"
          />
          <ul v-if="selectedEventNotifications.length > 0" class="note-list">
            <li v-for="row in selectedEventNotifications" :key="row.id">
              <span>{{ row.target }}</span>
              <StatusTag
                :tone="row.acknowledgedAt !== null ? 'green' : row.escalatedAt !== null ? 'orange' : row.presentedAt !== null ? 'brand' : 'gray'"
                :text="row.acknowledgedAt !== null ? '已确认' : row.escalatedAt !== null ? '已升级' : row.presentedAt !== null ? '已展示' : '已生成'"
              />
              <span class="muted">{{ formatDateTime(row.createdAt) }}｜时限 {{ row.dueMinutes }} 分钟</span>
            </li>
          </ul>
        </div>

        <div v-if="selectedRecord.revisions.length > 0" class="block">
          <div class="block-title">修订历史</div>
          <ul class="note-list">
            <li v-for="(revision, index) in selectedRecord.revisions" :key="index">
              <span class="code">第 {{ index + 1 }} 次</span>
              <span>原值 {{ readText(revision.before.values) }}</span>
              <span class="muted">{{ formatDateTime(revision.at) }}｜{{ revision.by }}</span>
              <span class="muted">原因：{{ revision.reason }}</span>
            </li>
          </ul>
        </div>

        <template #actions>
          <AppButton size="sm" @click="selectedRecordId = ''">取消选中</AppButton>
        </template>
      </SectionCard>

      <EmptyState
        v-else
        title="点击图上的数据点查看明细"
        sub="节点显示该条记录的基准快照、规则版本、事件编号与通知确认状态"
      />
    </template>
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
  min-width: 260px;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  padding-bottom: 8px;
}

.head-row {
  margin-bottom: 12px;
}

.block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.note-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}

.note-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--canvas);
}
</style>

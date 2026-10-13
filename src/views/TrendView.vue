<script setup lang="ts">
/**
 * 监测趋势：单测点、单指标。
 *
 * 不同单位的指标不共轴，因此先选测点（决定指标与单位），再在同类指标内部按字段出图；
 * 温湿度的温度与湿度单位不同，分开两张图。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MetricValueKey, MetricValues, Point } from '@/types/domain'
import { metricDef, pointTypeDef } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useRecordsStore } from '@/stores/records'
import { buildTrendSeries, type TrendSeriesSpec } from '@/core/chart/trend'
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import { stateLabel } from '@/core/rules'
import { useClockStore } from '@/stores/clock'
import { RANGE_OPTIONS, resolveRange, type RangePreset } from '@/core/chart/range'
import { buildSnapshot } from '@/assistant/selectors'
import { answerCompare } from '@/assistant/compare/query'
import FeatureResult from '@/components/assistant/preview/FeatureResult.vue'
import { resolvePointTarget } from '@/assistant/deepLink'
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import DescList from '@/components/ui/info/DescList.vue'
import TrendChart from '@/components/charts/TrendChart.vue'

const archive = useArchiveStore()
const records = useRecordsStore()
const events = useEventsStore()

const clock = useClockStore()
const customStart = ref('')
const customEnd = ref('')
const pointId = ref('')
const rangeDays = ref<RangePreset>('30')
const onlyValid = ref(false)
const selectedRecordId = ref('')

const route = useRoute()
const router = useRouter()

/** 深链 `?point=<测点ID>`：助手回答里的"打开监测趋势"直接落到该测点。 */
const requestedPointId = computed(() => (typeof route.query.point === 'string' ? route.query.point : ''))
const deepLink = computed(() =>
  resolvePointTarget(requestedPointId.value, (id) => {
    const row = archive.pointById(id)
    return row === undefined ? undefined : { code: row.code, archived: row.status !== 'active' }
  }),
)

/**
 * 默认选点：深链优先，其次沿用当前选择，最后退到第一个有规则的测点。
 * 深链无效时**清空选择**并显示原因 —— 不能默默换一个测点，否则页面显示的对象与链接里的不是同一个。
 */
function pickPoint(): void {
  const requested = requestedPointId.value
  if (requested !== '') {
    pointId.value = deepLink.value.id
    return
  }
  if (pointId.value !== '' && archive.pointById(pointId.value) !== undefined) return
  const first = archive.activePoints.find((row) => archive.ruleFor(row.id, clock.nowKey) !== undefined)
  pointId.value = first?.id ?? ''
}

onMounted(pickPoint)
watch(requestedPointId, pickPoint)

/** 用户在页面上换测点时同步回 URL：链接与页面始终说的是同一个测点。 */
watch(pointId, (id) => {
  if (id === requestedPointId.value) return
  const second = typeof route.query.points === 'string' ? route.query.points.split(',')[1] : undefined
  void router.replace({ query: { ...route.query, point: id === '' ? undefined : id, points: second ? `${id},${second}` : undefined } })
})

const point = computed<Point | undefined>(() => archive.pointById(pointId.value))
const def = computed(() => (point.value === undefined ? undefined : metricDef(point.value.metric)))
/** 当前生效的规则：用于页面提示；图上每条记录按自己的采样时间取版本。 */
const rule = computed(() => (point.value === undefined ? undefined : archive.ruleFor(point.value.id, clock.nowKey)))

const pointRecords = computed(() => (point.value === undefined ? [] : records.ofPoint(point.value.id)))
const pointEvents = computed(() => (point.value === undefined ? [] : events.eventsOfPoint(point.value.id)))

const range = computed(() => {
  try {
    const explicit = Number(route.query.from)
    const end = Number(route.query.to)
    const shared = route.query.range === rangeDays.value && Number.isFinite(explicit) && Number.isFinite(end) && end > explicit
      ? { preset: rangeDays.value, from: explicit, toExclusive: end, label: RANGE_OPTIONS.find(r => r.value === rangeDays.value)!.label }
      : resolveRange({ preset: rangeDays.value, now: clock.nowKey, start: customStart.value, end: customEnd.value })
    return { ...shared, to: shared.toExclusive - 1, error: '' }
  } catch (cause) {
    return { preset: rangeDays.value, from: 0, to: 0, toExclusive: 0, label: '', error: String(cause instanceof Error ? cause.message : cause) }
  }
})
watch(() => route.query.range, value => {
  if (typeof value === 'string' && RANGE_OPTIONS.some(r => r.value === value)) rangeDays.value = value as RangePreset
}, { immediate: true })
watch(rangeDays, value => {
  if (value !== route.query.range) void router.replace({ query: { ...route.query, range: value, from: undefined, to: undefined } })
})
watch([customStart,customEnd],() => {
  if (route.query.from !== undefined) void router.replace({ query: { ...route.query, from: undefined, to: undefined } })
})
const comparisonIds = computed(() => typeof route.query.points === 'string' ? route.query.points.split(',') : [])
const comparison = computed(() => comparisonIds.value.length === 2 && !range.value.error
  ? answerCompare(buildSnapshot(), '', { pointIds: comparisonIds.value, range: range.value }).previews?.[0] : undefined)
function changeComparison(event: Event): void {
  const second = (event.target as HTMLSelectElement).value
  void router.replace({ query: { ...route.query, points: second ? `${pointId.value},${second}` : undefined } })
}

/** 按字段分图：每个字段一列，单位不同的字段天然分开。 */
const seriesList = computed<{ spec: TrendSeriesSpec; series: ReturnType<typeof buildTrendSeries> }[]>(() => {
  const target = point.value
  const metric = def.value
  if (target === undefined || metric === undefined || range.value.error) return []
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
      不同单位的指标分卡展示，双点比较共享同一时间范围；图上分级与预警中心的事件完全同源。
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
        <label class="filter"><span>第二测点（可选）</span><select class="ctl" :value="comparisonIds[1] || ''" @change="changeComparison"><option value="">只看一个测点</option><option v-for="item in archive.activePoints.filter(p => p.id !== pointId)" :key="item.id" :value="item.id">{{ item.code }}</option></select></label>
        <template v-if="rangeDays === 'custom'"><label class="filter"><span>起始日期</span><input v-model="customStart" class="ctl" type="date" /></label><label class="filter"><span>结束日期</span><input v-model="customEnd" class="ctl" type="date" /></label></template>
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

    <EmptyState
      v-if="point === undefined"
      :title="deepLink.reason === '' ? '尚未选择测点' : '深链里的测点打不开'"
      :sub="deepLink.reason === '' ? '在上方选择一个测点后查看趋势' : deepLink.reason"
    />

    <FeatureResult v-else-if="comparison" :preview="comparison" />
    <template v-else>
      <p v-if="range.error" class="notice notice--warn">{{ range.error }}</p>
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

<script setup lang="ts">
/**
 * 传感器状态驾驶舱。
 *
 * 数据来源与口径：整页只用助手侧的只读快照（`buildSnapshot` + `selectors`），
 * 所以卡片、队列、小瞳三处说的一定是同一个数、同一条事件。
 * 图表与明细放在现有统计报表页，这里不另造一套大屏 —— 方案要求"优先完成已有页面与卡片的联动"。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { hasNumericReadings, metricDef } from '@/types/catalog'
import type { MetricKey, MetricValueKey } from '@/types/domain'
import { formatDateTime } from '@/core/time'
import { humanGap } from '@/assistant/selectors'
import { buildEventHistory, buildReadingTrend, buildStageDurations, dominantMetricOf, sensorPointsOf } from '@/core/chart/dashboard'
import { dashboardSummaryOf, useDashboardSnapshot } from '@/components/dashboard/liveSnapshot'
import SensorCardWall from '@/components/dashboard/SensorCardWall.vue'
import AnomalyQueue from '@/components/dashboard/AnomalyQueue.vue'
import InsightBoards from '@/components/dashboard/InsightBoards.vue'
import ReadingTrendChart from '@/components/charts/ReadingTrendChart.vue'
import EventHistoryChart from '@/components/charts/EventHistoryChart.vue'
import StageDurationChart from '@/components/charts/StageDurationChart.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { NO_HEARTBEAT_NOTE } from '@/components/dashboard/text'
import WorkspaceWelcome from '@/components/visual/WorkspaceWelcome.vue'

const router = useRouter()
const snapshot = useDashboardSnapshot()

const buildingId = ref('')
const floorId = ref('')
const metric = ref<MetricKey | ''>('')
const chartField = ref<MetricValueKey | ''>('')
/** null 表示当前指标的全部测点，空数组表示用户明确取消了全部勾选。 */
const chartSelected = ref<string[] | null>(null)

/** 指标选项：只列在册传感器测点实际用到的指标（列表按用量排序，不虚构） */
const metricOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const point of snapshot.value.points) {
    if (point.archived || !hasNumericReadings(point.metric)) continue
    counts.set(point.metric, (counts.get(point.metric) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ value: key, label: `${metricDef(key as never).name}（${count}）` }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const floors = computed(() => {
  const rows = snapshot.value.points.filter((row) => !row.archived && (buildingId.value === '' || row.buildingId === buildingId.value))
  return [...new Set(rows.map((row) => row.floorName))].sort()
})

/** 卡墙的测点：只含传感器测点（人工检查点不产生数值读数，另列在下方说明里） */
const pointIds = computed(() =>
  snapshot.value.points
    .filter((row) => !row.archived && hasNumericReadings(row.metric))
    .filter((row) => buildingId.value === '' || row.buildingId === buildingId.value)
    .filter((row) => floorId.value === '' || row.floorName === floorId.value)
    .filter((row) => metric.value === '' || row.metric === metric.value)
    .map((row) => row.id),
)

const chartMetricOptions = computed(() => {
  const counts = new Map<MetricKey, number>()
  for (const point of snapshot.value.points) {
    if (point.archived || !hasNumericReadings(point.metric)) continue
    if (buildingId.value !== '' && point.buildingId !== buildingId.value) continue
    if (floorId.value !== '' && point.floorName !== floorId.value) continue
    counts.set(point.metric, (counts.get(point.metric) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count, name: metricDef(key).name }))
})
/**
 * 卡墙点一下 = 聚焦单个测点：下方趋势图切到**这个测点自己的指标**（单位、阈值、字段都跟着走）。
 * 聚焦优先于"维度"筛选器；用户一动筛选器就取消聚焦，筛选器永远说了算。
 */
const trendAnchor = ref<HTMLElement | null>(null)
const focusedPointId = ref('')
const focusedPoint = computed(() =>
  focusedPointId.value === '' ? null : snapshot.value.points.find((row) => row.id === focusedPointId.value) ?? null,
)
const chartMetric = computed(() =>
  focusedPoint.value !== null
    ? focusedPoint.value.metric
    : metric.value || dominantMetricOf(sensorPointsOf(snapshot.value, pointIds.value)),
)
const chartFields = computed(() => chartMetric.value === '' ? [] : metricDef(chartMetric.value).fields)
const activeField = computed(() => chartFields.value.find((row) => row.key === chartField.value)?.key ?? chartFields.value[0]?.key ?? '')
const chartPoints = computed(() => snapshot.value.points.filter((row) => pointIds.value.includes(row.id) && row.metric === chartMetric.value))
const chartPointIds = computed(() => chartSelected.value === null
  ? chartPoints.value.map((row) => row.id)
  : chartPoints.value.filter((row) => chartSelected.value?.includes(row.id)).map((row) => row.id))

// 换筛选就取消聚焦：不然图表会停在一个已被筛掉、卡片也看不见的测点上
watch([buildingId, floorId, metric], () => {
  chartSelected.value = null
  focusedPointId.value = ''
})
watch(chartMetric, () => { chartField.value = '' })

/**
 * ① 指标类型：点正在显示的那个**再点一次 = 回到综合**（清掉指标筛选与卡墙聚焦，
 * 卡墙重新显示全部传感器）。判定用 `chartMetric` 而不是筛选值本身 ——
 * 卡墙聚焦时高亮的也是它，用户看到的"当前指标"才是他要点掉的那个。
 */
function pickMetric(key: MetricKey): void {
  if (chartMetric.value === key) {
    metric.value = ''
    focusedPointId.value = ''
    chartSelected.value = null
    return
  }
  metric.value = key
}

/** 点卡片：同一张再点一次取消；换一张就切过去，并把趋势图滚进视野 */
function focusFromWall(id: string): void {
  if (focusedPointId.value === id) {
    focusedPointId.value = ''
    chartSelected.value = null
    return
  }
  focusedPointId.value = id
  chartSelected.value = [id]
  void nextTick(() => trendAnchor.value?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

function toggleChartPoint(id: string): void {
  const current = chartSelected.value ?? chartPoints.value.map((row) => row.id)
  chartSelected.value = current.includes(id) ? current.filter((row) => row !== id) : [...current, id]
}

const scopedForQueue = computed(() => {
  const scoped = pointIds.value
  return scoped.length === snapshot.value.points.filter((row) => !row.archived && hasNumericReadings(row.metric)).length ? null : scoped
})

const manualCount = computed(() => snapshot.value.points.filter((row) => !row.archived && !hasNumericReadings(row.metric)).length)

/** 数据更新时间：最近一次有效采样与最近一次录入分开报，不合并 */
const update = computed(() => {
  const summary = dashboardSummaryOf(snapshot.value, pointIds.value)
  return {
    sample: summary.sample,
    entered: summary.entered,
    gap: summary.sample === '' ? '' : humanGapText(summary.sample),
  }
})

function humanGapText(at: string): string {
  return humanGap(at, snapshot.value.now)
}

const unclosed = computed(() => dashboardSummaryOf(snapshot.value, pointIds.value).openTotal)

/**
 * 三张图都吃同一份快照与同一组筛选，所以图上的数、卡片上的数与问筑瞳答的数必然一致。
 * 图表只负责画（option 与点击在各自组件里），口径推导在 `core/chart/dashboard.ts`。
 */
const readingTrend = computed(() => buildReadingTrend(snapshot.value, chartPointIds.value, chartMetric.value, activeField.value))
const eventHistory = computed(() => buildEventHistory(snapshot.value, pointIds.value))
const stageDurations = computed(() => buildStageDurations(snapshot.value, pointIds.value))

function openPoint(pointId: string): void {
  void router.push({ path: '/trend', query: { point: pointId } })
}

function openEvent(eventId: string): void {
  void router.push({ path: '/alarms', query: { event: eventId } })
}

function openPendingOrders(): void {
  void router.push({ path: '/issues', query: { workOrder: 'open' } })
}

function resetFilters(): void {
  buildingId.value = ''
  floorId.value = ''
  metric.value = ''
}
</script>

<template>
  <div class="stack">
    <WorkspaceWelcome title="细微的变化，也值得被看见。" description="从同一份监测记录出发，查看测点、趋势与待办事件；有异常时，继续跟进现场处置。" compact />
    <details class="scope-info">
      <summary><b>数据与状态口径</b><span>演示数据 · 看板与小瞳同源</span></summary>
      <p>卡片、队列与图表读取当前数据集的有效记录和判定结果。这里不自动判断在线或离线。{{ NO_HEARTBEAT_NOTE }}</p>
    </details>

    <SectionCard title="筛选" sub="按楼栋、楼层或指标筛；卡片、队列与下面的更新时间都跟着同一份筛选结果">
      <div class="filters">
        <label class="filter">
          <span>楼栋</span>
          <select v-model="buildingId" class="ctl" @change="floorId = ''">
            <option value="">全部楼栋</option>
            <option v-for="row in snapshot.buildings.filter((b) => !b.archived)" :key="row.id" :value="row.id">{{ row.name }}</option>
          </select>
        </label>
        <label class="filter">
          <span>楼层</span>
          <select v-model="floorId" class="ctl">
            <option value="">全部楼层</option>
            <option v-for="row in floors" :key="row" :value="row">{{ row }}</option>
          </select>
        </label>
        <label class="filter">
          <span>指标</span>
          <select v-model="metric" class="ctl">
            <option value="">全部指标</option>
            <option v-for="row in metricOptions" :key="row.value" :value="row.value">{{ row.label }}</option>
          </select>
        </label>
        <AppButton size="sm" @click="resetFilters">重置筛选</AppButton>
      </div>

      <div class="summary">
        <StatusTag tone="brand" :text="`当前筛选：传感器测点 ${pointIds.length} 个`" :dot="false" />
        <StatusTag tone="gray" :text="`未关闭事件 ${unclosed} 条`" :dot="false" />
        <StatusTag v-if="manualCount > 0" tone="gray" :text="`另有 ${manualCount} 个人工检查点（不产生数值读数）`" :dot="false" />
      </div>
      <p class="field-hint">
        最近一次有效采样：{{ update.sample === '' ? '暂无' : `${formatDateTime(update.sample)}（${update.gap}）` }}｜
        最近一次录入：{{ update.entered === '' ? '暂无' : formatDateTime(update.entered) }}。
        两个时间分开报：补录时它们本来就不一样。
      </p>
    </SectionCard>

    <InsightBoards :snapshot="snapshot" :point-ids="pointIds" />

    <SensorCardWall :point-ids="pointIds" :focused-point-id="focusedPointId" @focus="focusFromWall" />

    <div ref="trendAnchor">
    <SectionCard title="多维传感器趋势" sub="选指标、数值维度与测点；同一图只叠加相同维度，不把不同单位混在一根纵轴">
      <p v-if="focusedPoint !== null" class="focus-note">
        <b>卡墙聚焦：</b>{{ focusedPoint.code }} {{ focusedPoint.name }}（{{ metricDef(focusedPoint.metric).name }}）——
        下面的趋势图正画着它；点同一张卡片或
        <button type="button" class="focus-clear" @click="focusedPointId = ''; chartSelected = null">取消聚焦</button>
        回到按指标叠加。
      </p>
      <div class="trend-controls">
        <div class="trend-control">
          <strong>① 指标类型</strong>
          <div class="trend-options" role="group" aria-label="选择趋势指标">
            <button v-for="row in chartMetricOptions" :key="row.key" type="button" class="trend-option"
              :class="{ 'trend-option--on': chartMetric === row.key }" :aria-pressed="chartMetric === row.key"
              :title="chartMetric === row.key ? '再点一次回到综合（全部指标）' : `只看${row.name}`"
              @click="pickMetric(row.key)">{{ row.name }} <small>{{ row.count }}</small></button>
          </div>
        </div>
        <div v-if="chartFields.length > 1" class="trend-control">
          <strong>② 数值维度</strong>
          <div class="trend-options" role="group" aria-label="选择数值维度">
            <button v-for="field in chartFields" :key="field.key" type="button" class="trend-option"
              :class="{ 'trend-option--on': activeField === field.key }" :aria-pressed="activeField === field.key"
              @click="chartField = field.key">{{ field.label }} <small>{{ field.unit }}</small></button>
          </div>
        </div>
        <div v-if="chartPoints.length > 0" class="trend-control">
          <strong>③ 测点叠加</strong>
          <div class="trend-options" role="group" aria-label="选择趋势测点">
            <label v-for="point in chartPoints" :key="point.id" class="trend-point">
              <input type="checkbox" :checked="chartPointIds.includes(point.id)" @change="toggleChartPoint(point.id)" />
              {{ point.code }} <small>{{ point.name }}</small>
            </label>
            <button v-if="chartSelected !== null" type="button" class="trend-all" @click="chartSelected = null; focusedPointId = ''">全选测点</button>
          </div>
        </div>
      </div>
      <ReadingTrendChart :model="readingTrend" @select-point="openPoint" @select-event="openEvent" />
    </SectionCard>
    </div>

    <AnomalyQueue :point-ids="scopedForQueue" />

    <SectionCard title="近 7 日预警事件" sub="按事件去重（证据条数与升级次数不重复计数），柱子按未关闭／已关闭拆分">
      <EventHistoryChart :model="eventHistory" @select-event="openEvent" />
    </SectionCard>

    <SectionCard title="处置阶段耗时" sub="预警、派工、维修、验收各段平均用了多久；缺样本的阶段留空，不按 0 小时计">
      <StageDurationChart :model="stageDurations" @select-pending="openPendingOrders" />
    </SectionCard>

    <SectionCard title="统计与报表" sub="按日、周、月与自定义范围筛楼栋、测点、来源；图表与 CSV 用同一份筛选结果">
      <p class="field-hint">
        三项管理指标、明细导出与单事件处置报告在现有「管理报表」页；看板不另造一套统计口径 ——
        两处的分子分母与"暂无数据"写法都由同一批选择器给出。
      </p>
      <AppButton size="sm" @click="router.push('/reports')">打开管理报表</AppButton>
    </SectionCard>
  </div>
</template>

<style scoped>
.stack { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 14px; }
.scope-info { padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper); font-size: 12px; color: var(--text-2); }
.scope-info summary { cursor: pointer; min-height: 24px; }.scope-info summary b { margin-right: 14px; color: var(--text); }.scope-info p { margin-top: 12px; line-height: 1.8; }
.focus-note {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--brand-600);
  border-radius: var(--r-sm); background: var(--brand-050); color: var(--brand-700); font-size: 12px;
}
.focus-clear {
  border: 0; background: none; padding: 0; color: var(--brand-700);
  font: inherit; text-decoration: underline; cursor: pointer;
}
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.filter { display: grid; gap: 3px; min-width: 168px; }
.filter span { color: var(--text-3); font-size: 11.5px; }
.summary { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.trend-controls { display: grid; gap: 10px; margin-bottom: 14px; }
.trend-control { display: grid; gap: 6px; }
.trend-control strong { color: var(--text-2); font-size: 12px; }
.trend-options { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.trend-option, .trend-all { border: 1px solid var(--line-strong); border-radius: 6px; background: var(--paper); color: var(--text-2); padding: 6px 10px; cursor: pointer; }
.trend-option--on { border-color: var(--brand-500); background: var(--brand-050); color: var(--brand-700); font-weight: 700; }
.trend-option small, .trend-point small { color: var(--text-3); font-weight: 400; }
.trend-point { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; color: var(--text-2); font-size: 11px; cursor: pointer; }
.trend-point input { accent-color: var(--brand-500); }
</style>

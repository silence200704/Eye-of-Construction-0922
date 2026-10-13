<script setup lang="ts">
/**
 * 传感器状态卡墙。
 *
 * 数字全部来自**助手侧的同一套只读选择器**（`buildSnapshot` + `selectors`），
 * 因此看板卡片、异常队列与小瞳回答指向的是同一个事件、同一份"最近有效读数"，
 * 不会出现"卡片一个数、小瞳另一个数"。
 *
 * 三条展示纪律（方案 §传感器状态驾驶舱）：
 * 1. 只显示**最近有效**读数：最新一条若是存疑/无效，卡片写明"已跳过"，不拿它当读数；
 * 2. 没有设备心跳时**不显示在线**：设备状态写成"人工登记"，未接入就写"无设备心跳"；
 * 3. 无读数就显示采样间隔与缺什么，不显示"正常"。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { formatDateTime } from '@/core/time'
import { fmtNumber } from '@/core/format'
import { DEMO_LIVE_SOURCE_LABEL, metricDef, qualityLabel, recordSourceLabel } from '@/types/catalog'
import { devicesOfPoint, freshnessOf, latestAnyRecord, latestValidRecord, openEventsOfPoint } from '@/assistant/selectors'
import { useDashboardSnapshot } from '@/components/dashboard/liveSnapshot'
import { levelText } from '@/assistant/selectors/events'
import { deviceStatusText, EMPTY_NOTE } from '@/components/dashboard/text'
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = withDefaults(defineProps<{ pointIds: string[]; focusedPointId?: string }>(), { focusedPointId: '' })
/** 点卡片 = 聚焦该测点，下方趋势图跟着切过来（父级决定画什么） */
const emit = defineEmits<{ focus: [pointId: string] }>()
const router = useRouter()

const snapshot = useDashboardSnapshot()

/** 一条读数：按指标字段逐项给出"标签 + 数值 + 单位"，不把不同单位并成一个尾缀 */
interface ReadingFact {
  label: string
  value: string
  unit: string
}

interface CardView {
  id: string
  code: string
  name: string
  place: string
  metric: string
  facts: ReadingFact[]
  hasReading: boolean
  sampleText: string
  freshness: 'current' | 'stale' | 'none'
  sourceText: string
  isDemoLive: boolean
  qualityText: string
  skippedNote: string
  healthText: string
  eventText: string
  eventId: string
  tone: 'green' | 'gray' | 'yellow' | 'orange' | 'red'
}

const cards = computed<CardView[]>(() =>
  props.pointIds.map((id) => cardOf(id)).filter((row): row is CardView => row !== null),
)

function cardOf(pointId: string): CardView | null {
  const point = snapshot.value.points.find((row) => row.id === pointId)
  if (point === undefined) return null
  const device = devicesOfPoint(snapshot.value, pointId)[0] ?? null
  const reading = latestValidRecord(snapshot.value.records, pointId)
  const latestAny = latestAnyRecord(snapshot.value.records, pointId)
  const open = openEventsOfPoint(snapshot.value.events, pointId)
  const top = open[0] ?? null
  const def = metricDef(point.metric)

  const facts: ReadingFact[] =
    reading === null
      ? []
      : def.fields
          .filter((field) => reading.values[field.key] !== undefined)
          .map((field) => ({ label: field.label, value: fmtNumber(reading.values[field.key] ?? null, field.digits), unit: field.unit }))

  const skipped =
    reading !== null && latestAny !== null && latestAny.id !== reading.id && latestAny.quality !== 'valid'
      ? `最新一条 ${latestAny.recordNo} 质量标记为「${qualityLabel(latestAny.quality)}」，已跳过`
      : ''

  const tone: CardView['tone'] = top === null ? 'gray' : top.level

  return {
    id: point.id,
    code: point.code,
    name: point.name,
    place: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`,
    metric: def.name,
    facts,
    hasReading: facts.length > 0,
    sampleText: reading === null ? '没有有效采样' : formatDateTime(reading.sampleTime),
    freshness: freshnessOf(reading?.sampleTime ?? null, snapshot.value.now),
    sourceText: reading === null ? '—' : recordSourceLabel(reading, snapshot.value.now),
    isDemoLive: reading !== null && recordSourceLabel(reading, snapshot.value.now) === DEMO_LIVE_SOURCE_LABEL,
    qualityText: reading === null ? '—' : qualityLabel(reading.quality),
    skippedNote: skipped,
    healthText: deviceStatusText(device?.health ?? 'none'),
    eventText: top === null ? '无未关闭事件' : `${top.eventNo}（${levelText(top.level)}）`,
    eventId: top?.id ?? '',
    tone,
  }
}

function openTrend(row: CardView): void {
  void router.push({ path: '/trend', query: { point: row.id } })
}

function openEvent(row: CardView): void {
  void router.push({ path: '/alarms', query: { event: row.eventId } })
}

function openPoint(row: CardView): void {
  const point = snapshot.value.points.find((item) => item.id === row.id)
  void router.push({ path: '/campus', query: point === undefined ? {} : { b: point.buildingId } })
}
</script>

<template>
  <SectionCard title="传感器状态" :sub="`${cards.length} 个在册传感器测点；读数只取最近一条有效记录，无心跳时不显示在线`" marked>
    <EmptyState
      v-if="cards.length === 0"
      title="当前筛选下没有传感器测点"
      sub="换个楼栋、楼层或指标再试；人工检查点不产生数值读数，不在本卡墙内"
    />
    <div v-else class="wall">
      <article
        v-for="row in cards"
        :key="row.id"
        class="sensor"
        :class="[`sensor--${row.tone}`, { 'sensor--on': row.id === focusedPointId }]"
        role="button"
        tabindex="0"
        :aria-pressed="row.id === focusedPointId"
        :aria-label="`${row.code} ${row.name}：点一下让下方趋势图切到这个测点`"
        @click="emit('focus', row.id)"
        @keydown.enter.prevent="emit('focus', row.id)"
        @keydown.space.prevent="emit('focus', row.id)"
      >
        <header class="head">
          <div class="title">
            <b>{{ row.code }}</b>
            <span class="muted">{{ row.name }}</span>
          </div>
          <StatusTag :tone="row.tone" :text="row.eventText" :dot="row.tone !== 'gray'" />
        </header>
        <p class="place muted">{{ row.place }}｜{{ row.metric }}</p>

        <div class="reading">
          <span v-if="row.isDemoLive" class="live-badge"><i aria-hidden="true" />实时传输 <small>演示数据</small></span>
          <span v-if="!row.hasReading" class="value value--empty">{{ EMPTY_NOTE.noReading }}</span>
          <span v-for="fact in row.facts" v-else :key="fact.label" class="fact">
            <i class="fact-label">{{ fact.label }}</i>
            <b class="value">{{ fact.value }}</b>
            <small v-if="fact.unit !== ''" class="unit">{{ fact.unit }}</small>
          </span>
        </div>
        <dl class="rows">
          <div class="row"><dt>采样时间</dt><dd>{{ row.sampleText }}</dd></div>
          <div class="row">
            <dt>读数新鲜度</dt>
            <dd>
              <template v-if="row.freshness === 'current'">近 30 分钟内</template>
              <template v-else-if="row.freshness === 'stale'">偏旧（本机无心跳，不能判断设备离线）</template>
              <template v-else>无有效读数</template>
            </dd>
          </div>
          <div class="row"><dt>来源</dt><dd>{{ row.sourceText }}</dd></div>
          <div class="row"><dt>质量</dt><dd>{{ row.qualityText }}</dd></div>
          <div class="row"><dt>设备状态</dt><dd>{{ row.healthText }}</dd></div>
        </dl>
        <p v-if="row.skippedNote !== ''" class="skip">{{ row.skippedNote }}</p>

        <footer class="ops">
          <button type="button" class="link" @click.stop="openTrend(row)">看趋势</button>
          <button type="button" class="link" @click.stop="openPoint(row)">在地图上定位</button>
          <button v-if="row.eventId !== ''" type="button" class="link" @click.stop="openEvent(row)">打开事件</button>
        </footer>
      </article>
    </div>
  </SectionCard>
</template>

<style scoped>
.wall { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); }
.sensor { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--line); border-left-width: 4px; border-radius: var(--r-md); background: var(--paper); cursor: pointer; }
.sensor:hover { border-color: var(--line-strong); }
.sensor:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
/* 聚焦态：图表正画着这一条 */
.sensor--on { border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-050); }
.sensor--gray { border-left-color: var(--line-strong); }
.sensor--green { border-left-color: var(--st-green); }
.sensor--yellow { border-left-color: var(--st-yellow); }
.sensor--orange { border-left-color: var(--st-orange); }
.sensor--red { border-left-color: var(--st-red); }
.head { display: grid; justify-items: start; gap: 8px; }
.title { display: grid; gap: 1px; }
.title b { font-family: var(--font-mono); font-size: 12.5px; }
.title .muted { font-size: 11.5px; }
.place { margin: 0; font-size: 11.5px; }
.reading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; padding: 16px; border-radius: var(--r-sm); background: var(--ink-800); }
.live-badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px 7px; background: var(--brand-050); color: var(--brand-700); font-size: 10.5px; font-weight: 700; }
.live-badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.live-badge small { color: var(--text-3); font-size: 10px; font-weight: 400; }
.fact { display: inline-flex; align-items: baseline; gap: 3px; }
.fact-label { color: var(--brand-200); font-size: 11px; font-style: normal; }
.value { font-family: var(--font-mono); font-size: 30px; color: var(--paper); line-height: 1.3; letter-spacing: -.04em; }
.value--empty { color: var(--brand-200); font-size: 13px; }
.unit { color: var(--brand-200); font-size: 12px; }
.rows { display: grid; gap: 2px; margin: 0; }
.row { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 6px; font-size: 11.5px; }
.row dt { color: var(--text-3); }
.row dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
.skip { margin: 0; padding: 5px 7px; border-radius: var(--r-sm); background: var(--st-yellow-bg); color: var(--st-yellow); font-size: 11px; }
.ops { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 4px; border-top: 1px solid var(--line); }
.link { border: 0; background: none; color: var(--brand-700); font: inherit; font-size: 11.5px; cursor: pointer; padding: 4px 0; min-height: 34px; }
.link:hover { text-decoration: underline; }
.muted { color: var(--text-3); }
@media (max-width: 600px) { .link { min-height: 44px; }.wall { grid-template-columns: minmax(0, 1fr); } }
</style>

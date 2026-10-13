<script setup lang="ts">
/**
 * 预警中心：按未确认、处理中、恢复待确认筛选事件，查看触发记录、规则、基准与时间线。
 * 事件由规则判定自动生成或升级，同一点位同一规则在未关闭前只有一条事件。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { EVENT_LEVEL_LABEL, EVENT_STATUS_LABEL, EVENT_LEVEL_RANK, type EventLevel, type EventStatus } from '@/types/events'
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import EventDetailPanel from '@/components/panels/EventDetailPanel.vue'

const archive = useArchiveStore()
const events = useEventsStore()
const route = useRoute()
const router = useRouter()

const filterStatus = ref<EventStatus | ''>('')
const filterLevel = ref<EventLevel | ''>('')
const filterPoint = ref('')
const keyword = ref('')
/** 保养页"结构预警"分区跳来时的范围：只看未关闭事件 */
const unclosedOnly = ref(false)
const detailId = ref('')
const detailOpen = ref(false)
const caughtUp = ref(0)
const checkMessage = ref('')

onMounted(async () => {
  caughtUp.value = await events.catchUpEscalations()
  syncDetailFromRoute()
})

watch(() => route.query.event, syncDetailFromRoute)

/*
 * 分区卡片跳转带 `scope=unclosed` 时才筛未关闭。
 * 不读这个参数的话，从"结构预警 N 条"点进来看到的是全部事件（含已关闭），条数与卡片对不上。
 */
watch(
  () => route.query.scope,
  (value) => {
    unclosedOnly.value = value === 'unclosed'
  },
  { immediate: true },
)

const pointOptions = computed(() =>
  archive.activePoints.map((row) => ({ value: row.id, label: `${row.code} ${row.name}` })),
)

const rows = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return events.sorted
    .filter((row) => (unclosedOnly.value ? row.status !== 'closed' : true))
    .filter((row) => (filterStatus.value === '' ? true : row.status === filterStatus.value))
    .filter((row) => (filterLevel.value === '' ? true : row.level === filterLevel.value || row.peakLevel === filterLevel.value))
    .filter((row) => (filterPoint.value === '' ? true : row.pointId === filterPoint.value))
    .filter((row) => {
      if (text === '') return true
      return row.eventNo.toLowerCase().includes(text) || row.ruleCode.toLowerCase().includes(text)
    })
})

const kpis = computed(() => [
  { label: '待确认', value: events.countByStatus.pending, hint: '需要管理人员确认' },
  { label: '处理中', value: events.countByStatus.handling, hint: '已确认，等待排查处置' },
  { label: '恢复待确认', value: events.countByStatus.recovering, hint: '数据已回落，须授权关闭' },
  { label: '已关闭', value: events.countByStatus.closed, hint: '已填写关闭依据' },
])

const openLevelText = computed(() => {
  const counts = events.countByLevel
  return `未关闭事件：黄 ${counts.yellow}｜橙 ${counts.orange}｜红 ${counts.red}`
})

function levelTone(level: EventLevel): 'yellow' | 'orange' | 'red' {
  return level
}

function statusTone(status: EventStatus): 'red' | 'orange' | 'brand' | 'gray' {
  if (status === 'pending') return 'red'
  if (status === 'handling') return 'orange'
  if (status === 'recovering') return 'brand'
  return 'gray'
}

function openDetail(id: string): void {
  detailId.value = id
  detailOpen.value = true
  void router.replace({ query: { ...route.query, event: id } })
}

function syncDetailFromRoute(): void {
  const eventId = typeof route.query.event === 'string' ? route.query.event : ''
  if (eventId === '' || events.byId(eventId) === undefined) return
  detailId.value = eventId
  detailOpen.value = true
}

function closeDetail(): void {
  detailOpen.value = false
  const query = { ...route.query }
  delete query.event
  void router.replace({ query })
}

function resetFilters(): void {
  filterStatus.value = ''
  filterLevel.value = ''
  filterPoint.value = ''
  keyword.value = ''
}

function levelOrder(level: EventLevel): number {
  return -EVENT_LEVEL_RANK[level]
}

/** 现场演示用：不必等够演示时限，点一次即补查超时通知并记录升级去向。 */
async function checkOverdue(): Promise<void> {
  caughtUp.value = await events.catchUpEscalations()
  if (caughtUp.value === 0) {
    const next = events.notifications
      .filter((row) => row.acknowledgedAt === null && row.escalatedAt === null)
      .map((row) => row.dueMinutes)
    checkMessage.value =
      next.length === 0 ? '没有未确认的通知' : `没有通知超过演示确认时限（最近一条时限 ${Math.min(...next)} 分钟）`
  } else {
    checkMessage.value = ''
  }
}

async function acknowledge(rowId: string): Promise<void> {
  await events.acknowledgeEvent(rowId)
  caughtUp.value = 0
}

/** 等级排序用于表格默认排序：严重的排前面。 */
const sortedRows = computed(() =>
  [...rows.value].sort((a, b) => levelOrder(a.level) - levelOrder(b.level) || (a.lastTriggerAt < b.lastTriggerAt ? 1 : -1)),
)
</script>

<template>
  <div class="stack">
    <p class="notice notice--warn">
      <b>预警口径：</b>事件由「筑瞳 Demo 演示预警规则 V1.0」判定生成，用于验证通知与处置流程，<b>不是国家建筑安全标准</b>。
      同一点位同一条规则在未关闭前只保留一条事件，新证据追加进去，等级升高时记录升级历史。
    </p>

    <p v-if="checkMessage !== ''" class="notice notice--brand">{{ checkMessage }}</p>

    <p v-if="caughtUp > 0" class="notice notice--warn">
      重新打开后补查到期事项：{{ caughtUp }} 条通知已超过演示确认时限，已按规则标记升级去向。
    </p>

    <div class="grid-4">
      <div v-for="item in kpis" :key="item.label" class="kpi">
        <div class="kpi-label">{{ item.label }}</div>
        <div class="kpi-value">{{ item.value }}</div>
        <div class="kpi-foot">{{ item.hint }}</div>
      </div>
    </div>

    <SectionCard title="事件清单" :sub="openLevelText" marked>
      <template #actions>
        <AppButton size="sm" @click="resetFilters">重置筛选</AppButton>
        <AppButton size="sm" @click="checkOverdue">立即检查超时通知</AppButton>
      </template>

      <div class="filters">
        <label class="filter">
          <span>状态</span>
          <select v-model="filterStatus" class="ctl">
            <option value="">全部</option>
            <option v-for="(label, key) in EVENT_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="filter">
          <span>等级</span>
          <select v-model="filterLevel" class="ctl">
            <option value="">全部</option>
            <option v-for="(label, key) in EVENT_LEVEL_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="filter">
          <span>测点</span>
          <select v-model="filterPoint" class="ctl">
            <option value="">全部</option>
            <option v-for="item in pointOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="filter filter--wide">
          <span>关键词</span>
          <input v-model="keyword" class="ctl" type="search" placeholder="事件编号或规则编号" />
        </label>
      </div>

      <DataTable
        :columns="[
          { key: 'no', label: '事件编号', width: '150px' },
          { key: 'point', label: '测点' },
          { key: 'rule', label: '规则', width: '150px' },
          { key: 'level', label: '等级', width: '150px' },
          { key: 'status', label: '状态', width: '110px' },
          { key: 'trigger', label: '最近触发', width: '150px' },
          { key: 'evidence', label: '证据/升级', width: '96px', align: 'right' },
          { key: 'ops', label: '操作', width: '140px' },
        ]"
        :row-count="sortedRows.length"
        empty="暂无预警事件。录入越限数据后，系统会自动生成事件"
      >
        <tr v-for="row in sortedRows" :key="row.id" class="clickable" @click="openDetail(row.id)">
          <td class="code">{{ row.eventNo }}</td>
          <td>
            <div>{{ archive.pointLabel(row.pointId) }}</div>
            <div class="code">{{ archive.pointById(row.pointId)?.zoneId ?? '' }}</div>
          </td>
          <td class="code">{{ row.ruleCode }}</td>
          <td>
            <StatusTag :tone="levelTone(row.level)" :text="EVENT_LEVEL_LABEL[row.level]" />
            <div v-if="row.peakLevel !== row.level" class="code">最高 {{ EVENT_LEVEL_LABEL[row.peakLevel] }}</div>
          </td>
          <td><StatusTag :tone="statusTone(row.status)" :text="EVENT_STATUS_LABEL[row.status]" /></td>
          <td>
            <div class="num">{{ formatDateTime(row.lastTriggerAt) }}</div>
            <div class="code num">{{ fmtNumber(row.lastTriggerValue, 2) }} {{ row.unit }}</div>
          </td>
          <td class="ta-r num">{{ row.evidences.length }} / {{ row.upgrades.length }}</td>
          <td>
            <div class="ops">
              <AppButton size="sm" variant="ghost" @click.stop="openDetail(row.id)">详情</AppButton>
              <AppButton v-if="row.status === 'pending'" size="sm" variant="ghost" @click.stop="acknowledge(row.id)">确认</AppButton>
            </div>
          </td>
        </tr>
      </DataTable>
    </SectionCard>

    <EmptyState
      v-if="events.events.length === 0"
      title="还没有预警事件"
      sub="到「监测数据」录入一条越限数据（例如裂缝测点 0.62 mm），系统会按规则自动生成事件"
    />


    <EventDetailPanel :open="detailOpen" :event-id="detailId" @close="closeDetail" />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 14px;
}

.filter {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
  min-width: 140px;
}

.filter--wide {
  flex: 1;
  min-width: 200px;
}

.clickable {
  cursor: pointer;
}

.ops {
  display: flex;
  gap: 2px;
}
</style>

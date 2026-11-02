<script setup lang="ts">
/**
 * 管理报表（V1-E）：三项指标 + 明细导出 + 单事件处置报告入口。
 *
 * 三条口径：
 * ① 本地业务与临时示例共用指标计算；临时示例仅驻留内存，并明确标识来源；
 * ② 指标卡把定义、分子、分母、时间范围、不纳入条件一起显示，答辩时能当场解释数字怎么来的；
 * ③ 导出的是**当前筛选条件下的明细**：页面看到多少条，CSV 里就多少条。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import DataTable from '@/components/ui/DataTable.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import IndicatorCard from '@/components/metrics/IndicatorCard.vue'
import { downloadCsv, eventRows, issueRows, maintenanceRows, orderRows, type NameResolvers } from '@/core/metrics/export'
import { allIndicators, rangeOf, type Indicator, type MetricsRange } from '@/core/metrics/indicators'
import { backendActive } from '@/api/backend/runtime'
import { fetchIndicators, fetchReportExport } from '@/api/backend/field'
import { reportDemoData } from '@/core/metrics/demoData'
import { localDayKey } from '@/core/maintenance/plan'
import { formatDateTime } from '@/core/time'
import { EVENT_LEVEL_LABEL, EVENT_STATUS_LABEL } from '@/types/events'
import { ISSUE_STATUSES, WORK_ORDER_STATUSES } from '@/types/inspection'
import { MAINTENANCE_STATUSES } from '@/types/maintenance'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'
import { useArchiveStore } from '@/stores/archive'
import { useClockStore } from '@/stores/clock'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'

const archive = useArchiveStore()
const clock = useClockStore()
const events = useEventsStore()
const issues = useIssueStore()
const orders = useWorkOrderStore()
const maintenance = useMaintenanceTaskStore()
const router = useRouter()

const preset = ref('month')
const customFrom = ref('')
const customTo = ref('')
const buildingId = ref('')
const pointId = ref('')
const exportNote = ref('')
const demoData = computed(() => reportDemoData({ today: clock.todayKey, points: archive.points, devices: archive.devices }))
/** 每张明细表各自的状态筛选：四类对象的状态取值不同，共用一个下拉只会互相误导 */
const statusPicked = ref<Record<string, string>>({ events: '', issues: '', orders: '', maintenance: '' })

const range = computed<MetricsRange | null>(() => {
  if (preset.value === 'custom') {
    if (customFrom.value === '' || customTo.value === '') return null
    return { from: customFrom.value, to: customTo.value }
  }
  return rangeOf(preset.value, clock.todayKey)
})

/** 事件状态用 Record 存储，这里转成下拉需要的 { key, name } 列表。 */
const EVENT_STATUS_OPTIONS = Object.entries(EVENT_STATUS_LABEL).map(([key, name]) => ({ key, name }))

const rangeText = computed(() =>
  range.value === null ? `不限时间（数据截至 ${clock.todayKey}）` : `${range.value.from} ~ ${range.value.to}`,
)
const buildingText = computed(() => {
  if (buildingId.value === '') return '全部楼栋'
  return archive.buildingById(buildingId.value)?.name ?? buildingId.value
})

function buildingOfPoint(pointId: string): string {
  return archive.pointById(pointId)?.buildingId ?? ''
}

const input = computed(() => ({
  events: events.events,
  issues: issues.issues,
  maintenanceTasks: maintenance.tasks,
  workOrders: orders.orders,
  buildingOfPoint: Object.fromEntries(archive.points.map((row) => [row.id, row.buildingId])) as Record<string, string>,
  range: range.value,
  buildingId: buildingId.value === '' ? null : buildingId.value,
}))

const businessIndicators = computed(() => allIndicators(input.value))
// 仅在响应与闭环都无统计、按期任务仍为零时补展示；演示产生有效结果后自动使用业务指标。
const useDemoIndicators = computed(() =>
  businessIndicators.value[0].value === null && businessIndicators.value[1].value === null
    && (businessIndicators.value[2].value === null || businessIndicators.value[2].value === 0),
)
/** 服务端模式下三项指标由数据库明细重算，不再在页面上拼口径。 */
const serverIndicators = ref<Indicator[]>([])
const indicators = computed(() => backendActive()
  ? serverIndicators.value
  : useDemoIndicators.value
    ? allIndicators({ ...input.value, ...demoData.value })
    : businessIndicators.value,
)

function reportParams(): Record<string, string> {
  const current = range.value
  return {
    ...(current === null ? {} : { start: current.from, end: current.to }),
    ...(buildingId.value === '' ? {} : { buildingId: buildingId.value }),
    ...(pointId.value === '' ? {} : { pointId: pointId.value }),
  }
}

async function reloadServerIndicators(): Promise<void> {
  if (!backendActive()) return
  const data = await fetchIndicators(reportParams())
  serverIndicators.value = data.indicators as Indicator[]
}

const names: NameResolvers = {
  point: (pointId) => (pointId === null ? '' : archive.pointLabel(pointId)),
  building: (id) => archive.buildingById(id)?.name ?? id,
  buildingOfPoint: (pointId) => buildingOfPoint(pointId),
}

/** 一行明细按哪些字段筛选：时间、楼栋、测点、状态。 */
interface RowAccess<T> {
  time: (row: T) => string
  building: (row: T) => string
  point: (row: T) => string | null
  status: (row: T) => string
}

/**
 * 明细筛选：**楼栋与时间与指标用同一套条件**，另加测点与状态。
 * 导出的是这里筛完的行，所以"页面看到多少条，CSV 里就多少条"。
 */
function selectRows<T>(rows: T[], key: string, access: RowAccess<T>): T[] {
  const current = range.value
  const status = statusPicked.value[key] ?? ''
  return rows.filter((row) => {
    if (buildingId.value !== '' && access.building(row) !== buildingId.value) return false
    if (pointId.value !== '' && access.point(row) !== pointId.value) return false
    if (status !== '' && access.status(row) !== status) return false
    if (current === null) return true
    const day = localDayKey(new Date(access.time(row)))
    return day >= current.from && day <= current.to
  })
}

/** 测点下拉只列当前楼栋的测点：跨楼栋选测点只会得到空表，那属于误导。 */
const pointOptions = computed(() =>
  archive.points.filter((row) => buildingId.value === '' || row.buildingId === buildingId.value),
)

/** 换楼栋时把不属于该楼的测点清除，避免筛选条件自相矛盾。 */
function onBuildingChange(): void {
  if (pointId.value === '' || buildingId.value === '') return
  const point = archive.pointById(pointId.value)
  if (point !== undefined && point.buildingId !== buildingId.value) pointId.value = ''
}

const eventDetail = computed(() =>
  selectRows<AlarmEvent>(events.events, 'events', {
    time: (row) => row.openedAt,
    building: (row) => buildingOfPoint(row.pointId),
    point: (row) => row.pointId,
    status: (row) => row.status,
  }).sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
)
const issueDetail = computed(() =>
  selectRows<InspectionIssue>(issues.issues, 'issues', {
    time: (row) => row.createdAt,
    building: (row) => row.buildingId,
    point: (row) => row.pointId,
    status: (row) => row.status,
  }),
)
const orderDetail = computed(() =>
  selectRows<WorkOrder>(orders.orders, 'orders', {
    time: (row) => row.createdAt,
    building: (row) => buildingOfPoint(row.pointId ?? ''),
    point: (row) => row.pointId,
    status: (row) => row.status,
  }),
)
const maintenanceDetail = computed(() =>
  selectRows<MaintenanceTask>(maintenance.tasks, 'maintenance', {
    time: (row) => row.plannedAt,
    building: (row) => row.snapshot.buildingId,
    point: (row) => row.snapshot.pointId,
    status: (row) => row.status,
  }),
)

/** 明细导出区的四行配置：状态下拉各用各的取值列表。 */
const exportRows = computed(() => [
  { key: 'events', label: '预警事件明细', options: EVENT_STATUS_OPTIONS, count: eventDetail.value.length },
  { key: 'issues', label: '问题明细', options: ISSUE_STATUSES, count: issueDetail.value.length },
  { key: 'orders', label: '工单明细', options: WORK_ORDER_STATUSES, count: orderDetail.value.length },
  { key: 'maintenance', label: '保养任务明细', options: MAINTENANCE_STATUSES, count: maintenanceDetail.value.length },
])

function tableOf(key: string): { header: string[]; rows: string[][] } {
  if (key === 'events') return eventRows(eventDetail.value, names)
  if (key === 'issues') return issueRows(issueDetail.value, names)
  if (key === 'orders') return orderRows(orderDetail.value, names)
  return maintenanceRows(maintenanceDetail.value)
}

function exportOf(label: string, table: { header: string[]; rows: string[][] }, count: number): void {
  if (count === 0) {
    exportNote.value = `${label}：当前筛选条件下没有明细，先切换到有数据的范围再导出。`
    return
  }
  downloadCsv(`zhutong-${label}-${clock.todayKey}.csv`, table.header, table.rows)
  exportNote.value = `${label}：已导出 ${count} 行（${rangeText.value}，${buildingText.value}）。`
}

async function exportRow(row: { key: string; label: string; count: number }): Promise<void> {
  if (backendActive()) {
    try {
      const data = await fetchReportExport(row.key, {
        ...reportParams(),
        ...(statusPicked.value[row.key] === '' ? {} : { status: statusPicked.value[row.key] }),
      })
      exportOf(row.label, { header: data.header, rows: data.rows }, data.count)
    } catch (cause) {
      exportNote.value = `${row.label}：导出失败——${(cause as Error).message}`
    }
    return
  }
  exportOf(row.label, tableOf(row.key), row.count)
}

/** 排除项"去处理"：保养逾期与复查逾期分别回各自工作台，不再新造入口。 */
function locate(label: string): void {
  void router.push(label.includes('保养') ? '/maintenance' : '/issues')
}

onMounted(async () => {
  if (!events.loaded) await events.reload()
  if (!issues.loaded) await issues.reload()
  if (!orders.loaded) await orders.reload()
  if (!maintenance.loaded) await maintenance.reload()
  await reloadServerIndicators()
})

watch([range, buildingId, pointId], () => {
  void reloadServerIndicators()
})
</script>

<template>
  <div class="stack">
    <SectionCard title="统计范围" sub="时间范围与楼栋同时生效；指标与明细导出用的是同一套筛选条件">
      <div class="filters">
        <label class="filter">
          <span>时间范围</span>
          <select v-model="preset" class="ctl">
            <option value="week">近 7 天</option>
            <option value="30d">近 30 天</option>
            <option value="month">本月</option>
            <option value="custom">自定义</option>
            <option value="all">不限时间</option>
          </select>
        </label>
        <label v-if="preset === 'custom'" class="filter">
          <span>起</span>
          <input v-model="customFrom" class="ctl" type="date" />
        </label>
        <label v-if="preset === 'custom'" class="filter">
          <span>止</span>
          <input v-model="customTo" class="ctl" type="date" />
        </label>
        <label class="filter">
          <span>楼栋</span>
          <select v-model="buildingId" class="ctl" @change="onBuildingChange">
            <option value="">全部楼栋</option>
            <option v-for="row in archive.buildings" :key="row.id" :value="row.id">{{ row.name }}</option>
          </select>
        </label>
        <label class="filter">
          <span>测点</span>
          <select v-model="pointId" class="ctl">
            <option value="">全部测点</option>
            <option v-for="row in pointOptions" :key="row.id" :value="row.id">{{ row.code }} {{ row.name }}</option>
          </select>
        </label>
        <AppButton variant="ghost" size="sm" @click="clock.refresh()">刷新状态</AppButton>
      </div>
      <p class="code">
        当前：{{ rangeText }}；{{ buildingText }}；口径里的"今天"取演示时钟 {{ clock.todayKey }}（手动刷新，不用后台定时器）。
      </p>
    </SectionCard>

    <IndicatorCard
      v-for="item in indicators"
      :key="item.key"
      :indicator="item"
      :range-text="rangeText"
      :building-text="buildingText"
      :on-locate="backendActive() || useDemoIndicators ? undefined : locate"
    />

    <SectionCard title="明细导出" sub="导出的就是下面这几张表在当前筛选条件下的行，每行都带业务编号，能回系统核对">
      <div class="export-rows">
        <div v-for="row in exportRows" :key="row.key" class="export-row">
          <span class="export-label">{{ row.label }}</span>
          <select v-model="statusPicked[row.key]" class="ctl" :aria-label="`${row.label}状态筛选`">
            <option value="">全部状态</option>
            <option v-for="item in row.options" :key="item.key" :value="item.key">{{ item.name }}</option>
          </select>
          <span class="code num">{{ row.count }} 行</span>
          <AppButton size="sm" :disabled="row.count === 0" @click="exportRow(row)">
            {{ row.count === 0 ? '无可导出明细' : '导出 CSV' }}
          </AppButton>
        </div>
      </div>
      <p v-if="exportNote !== ''" class="note">{{ exportNote }}</p>
    </SectionCard>

    <SectionCard title="事件处置报告" sub="点开事件，打印一页说清「为何预警、谁处置、如何验收、为何关闭」的报告">
      <DataTable
        :columns="[
          { key: 'no', label: '事件编号', width: '150px' },
          { key: 'point', label: '测点' },
          { key: 'level', label: '等级', width: '110px' },
          { key: 'status', label: '状态', width: '110px' },
          { key: 'opened', label: '产生时间', width: '150px' },
          { key: 'closed', label: '关闭时间', width: '150px' },
          { key: 'ops', label: '操作', width: '120px' },
        ]"
        :row-count="eventDetail.length"
        empty="暂无预警事件。录入越限数据后，系统会自动生成事件"
      >
        <tr v-for="row in eventDetail" :key="row.id">
          <td class="code">{{ row.eventNo }}</td>
          <td>{{ archive.pointLabel(row.pointId) }}</td>
          <td>{{ EVENT_LEVEL_LABEL[row.level] }}</td>
          <td>{{ EVENT_STATUS_LABEL[row.status] }}</td>
          <td class="num">{{ formatDateTime(row.openedAt) }}</td>
          <td class="num">{{ row.closedAt === null ? '（未关闭）' : formatDateTime(row.closedAt) }}</td>
          <td>
            <AppButton size="sm" variant="ghost" @click="router.push(`/reports/event/${row.id}`)">处置报告</AppButton>
          </td>
        </tr>
      </DataTable>
    </SectionCard>
  </div>
</template>

<style scoped>
.note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-2);
}
</style>

<script setup lang="ts">
/**
 * 设备保养（V1-D 设备保养台账）。
 *
 * 三个页签回答现场的三件事：计划怎么定、任务什么时候做（工作台）；这台设备保养得怎么样（台账）；
 * 这个月哪天该保养（日历）。页面上的每个数字都由 `core/maintenance/board` 的纯函数从仓储现算，
 * 空就显示"暂无数据"，不摆假数据、不做只展示不能写的空壳。
 *
 * 写入只有四个受控入口（都在两个保养 store 里）：`savePlan` / `setEnabled` / `generateForDay` / `execute`；
 * 页面不直接写库、也不自己写判定 —— 失败时把 store 返回的 error 原样提示。
 *
 * 四个分区各数各的数据源：**保养逾期不是结构预警** ——
 * 设备没按时保养属于设备管理，结构预警的依据是传感器证据链与规则判定，两者不能互相冒充。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MaintenanceBoardInput, MaintenanceViewKey, MaintenanceZone } from '@/core/maintenance/board'
import { maintenanceDayPlanHits, maintenanceTasksOnDay, maintenanceZones } from '@/core/maintenance/board'
import { useArchiveStore } from '@/stores/archive'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useEventsStore } from '@/stores/events'
import { useSessionStore } from '@/stores/session'
import { useClockStore } from '@/stores/clock'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import MaintenancePlans from '@/components/maintenance/MaintenancePlans.vue'
import MaintenanceTaskBoard from '@/components/maintenance/MaintenanceTaskBoard.vue'
import MaintenanceLedger from '@/components/maintenance/MaintenanceLedger.vue'
import MaintenanceCalendar from '@/components/maintenance/MaintenanceCalendar.vue'

const route = useRoute()
const router = useRouter()
const archive = useArchiveStore()
const session = useSessionStore()
const clock = useClockStore()
const plans = useMaintenancePlanStore()
const tasks = useMaintenanceTaskStore()
const workOrders = useWorkOrderStore()
const events = useEventsStore()

type TabKey = 'board' | 'ledger' | 'calendar'
const TABS: { key: TabKey; label: string; sub: string }[] = [
  { key: 'board', label: '保养工作台', sub: '计划、今日待办与执行面板' },
  { key: 'ledger', label: '保养台账', sub: '按设备汇总保养情况' },
  { key: 'calendar', label: '保养日历', sub: '按月看执行日与任务状态' },
]

const tab = ref<TabKey>('board')
const view = ref<MaintenanceViewKey>('today')
/**
 * 深链 `?task=<id>`（问题详情里点「打开保养任务」）：切到"全部待办"并直接展开这条任务。
 * 任务可能在"我的保养"或"逾期"视图下，用"全部待办"能保证它一定在列表里。
 */
const pickedTaskId = computed(() => {
  const value = route.query.task
  return typeof value === 'string' ? value : ''
})

// 带 ?task= 进来时先切到"全部待办"，否则目标任务不在当前视图的列表里，展开也没处展开
watch(
  pickedTaskId,
  (value) => {
    if (value !== '') {
      tab.value = 'board'
      view.value = 'all'
    }
  },
  { immediate: true },
)
const pickedDay = ref('')
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')

/** 工作台数据的统一入参：数据来自既有仓储，时间来自共享刻度（不用 Date.now() 做响应式） */
const boardInput = computed<MaintenanceBoardInput>(() => ({
  plans: plans.plans,
  tasks: tasks.tasks,
  devices: archive.devices,
  workOrders: workOrders.orders,
  events: events.events,
  actor: session.name,
  todayKey: clock.todayKey,
  now: new Date(clock.nowKey),
}))

const zones = computed(() => maintenanceZones(boardInput.value))
const dayHits = computed(() => (pickedDay.value === '' ? [] : maintenanceDayPlanHits(boardInput.value, pickedDay.value)))
const dayTasks = computed(() => (pickedDay.value === '' ? [] : maintenanceTasksOnDay(tasks.tasks, pickedDay.value)))

function notify(text: string, ok = true): void {
  tone.value = ok ? 'ok' : 'bad'
  message.value = text
}

/** 分区点击：保养逾期回到本页的逾期视图，其它分区带着筛选参数去对应页面 */
function onZone(zone: MaintenanceZone): void {
  if (zone.target.kind === 'view') {
    tab.value = 'board'
    pickedDay.value = ''
    view.value = zone.target.view
    return
  }
  void router.push({ path: zone.target.path, query: zone.target.query })
}

function pickDay(dayKey: string): void {
  pickedDay.value = dayKey
  tab.value = 'board'
  view.value = 'today'
}

/**
 * 立即刷新：逾期、今日待办、分区条数都按"现在"算，而 `Date.now()` 不是响应式的。
 * 给一个显式入口而不是后台定时器 —— 演示里不该出现说不清来源的自动变化。
 */
function refreshNow(): void {
  clock.refresh()
  const overdue = zones.value.find((row) => row.key === 'maintenance_overdue')?.count ?? 0
  notify(`已按当前时刻（${clock.todayKey}）刷新：保养逾期 ${overdue} 条｜设备离线 ${zones.value[1]?.count ?? 0} 台｜未验收工单 ${zones.value[2]?.count ?? 0} 张｜未关闭预警 ${zones.value[3]?.count ?? 0} 条`)
}

onMounted(async () => {
  await Promise.all([
    plans.loaded ? Promise.resolve() : plans.reload(),
    tasks.loaded ? Promise.resolve() : tasks.reload(),
    workOrders.loaded ? Promise.resolve() : workOrders.reload(),
    events.loaded ? Promise.resolve() : events.load(),
  ])
})
</script>

<template>
  <div class="stack">
    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <SectionCard title="设备保养" sub="计划 → 周期任务 → 执行留痕；设备保养与建筑结构监测分开计数，互不混用" marked>
      <div class="row-between zone-head">
        <span class="muted">
          四个分区分开统计，各数各的数据源（保养任务 / 设备档案 / 维修工单 / 预警事件）；
          条数都来自当前库里的数据，点一块跳到对应筛选结果
        </span>
        <AppButton size="sm" @click="refreshNow">按当前时刻刷新</AppButton>
      </div>

      <div class="zones">
        <button v-for="zone in zones" :key="zone.key" type="button" class="zone" @click="onZone(zone)">
          <span class="zone-title">{{ zone.title }}</span>
          <span class="zone-count num">{{ zone.count }}<em>{{ zone.unit }}</em></span>
          <span class="zone-criteria">{{ zone.criteria }}</span>
          <span class="zone-go">{{ zone.target.kind === 'view' ? '本站查看逾期任务 ›' : `前往 ${zone.target.path} ›` }}</span>
        </button>
      </div>

      <div class="tabs">
        <button
          v-for="item in TABS"
          :key="item.key"
          type="button"
          class="tab"
          :class="tab === item.key ? 'tab--active' : ''"
          @click="tab = item.key"
        >
          <b>{{ item.label }}</b>
          <span>{{ item.sub }}</span>
        </button>
      </div>

      <template v-if="tab === 'board'">
        <MaintenancePlans :devices="archive.devices" />

        <hr class="split" />

        <p v-if="pickedDay !== ''" class="notice notice--brand">
          已选执行日 {{ pickedDay }}：该天命中计划执行日 {{ dayHits.length }} 个<template v-if="dayHits.length > 0">（{{ dayHits.map((row) => row.code).join('、') }}）</template>，
          该天任务 {{ dayTasks.length }} 条。
          <button class="link" type="button" @click="pickedDay = ''">清除该天筛选</button>
        </p>

        <MaintenanceTaskBoard
          v-model:view="view"
          :input="boardInput"
          :day="pickedDay"
          :focus-task-id="pickedTaskId"
          @clear-day="pickedDay = ''"
          @notify="notify"
        />
      </template>

      <MaintenanceLedger v-else-if="tab === 'ledger'" :input="boardInput" />

      <MaintenanceCalendar v-else :input="boardInput" @select="pickDay" />

      <p class="field-hint">
        设备保养（V1-D）的写入只有四个受控入口：保存计划、启停计划、生成当日任务、提交本次保养结果；
        未完成的任务不会因为点开详情就变成完成，保养发现的异常只留痕或转问题处理。
      </p>
    </SectionCard>
  </div>
</template>

<style scoped>
.zone-head {
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}

.zones {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.zone {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  cursor: pointer;
  text-align: left;
}

.zone:hover {
  border-color: var(--brand-500);
}

.zone-title {
  font-size: 12.5px;
  color: var(--text-2);
}

.zone-count {
  font-size: 22px;
  font-weight: 600;
  color: var(--brand-700);
}

.zone-count em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--text-3);
  margin-left: 4px;
}

.zone-criteria {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
}

.zone-go {
  font-size: 11px;
  color: var(--brand-700);
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.tab {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--paper);
  cursor: pointer;
  text-align: left;
}

.tab b {
  font-size: 13px;
  color: var(--text-1);
}

.tab span {
  font-size: 11px;
  color: var(--text-3);
}

.tab--active {
  border-color: var(--brand-500);
  box-shadow: inset 0 0 0 1px var(--brand-500);
}

.split {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 16px 0 12px;
}

.link {
  border: 0;
  background: none;
  color: var(--brand-700);
  font-size: 12px;
  cursor: pointer;
  padding: 0 2px;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>

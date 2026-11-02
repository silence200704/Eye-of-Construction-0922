<script setup lang="ts">
/**
 * 3D 校园导览工作区：面包屑、逐级进入、三种楼层视图、原生楼层/测点按钮与事实卡。
 *
 * 分工：本组件管**页面状态与事实卡**；Three 场景（几何/相机/拾取）在 `SpatialScene.vue`；
 * 纯投影在 `core/spatial`。楼体与区域都是**档案驱动的程序化示意**，不是实测图纸或 BIM。
 *
 * 两条纪律写在这里：① 未建档楼层、无测点楼层如实显示空态，不伪造房间与读数；
 * ② 每个 3D 标记都有等价的键盘可达按钮，3D 点击只是"额外的入口"。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { EventLevel } from '@/types/events'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { buildSnapshot } from '@/assistant/selectors/snapshot'
import { factsOf, latestValidRecord } from '@/assistant/selectors/records'
import { formatDateTime } from '@/core/time'
import { buildSpatialTour, type SpatialTourResult, type SpatialTourStep } from '@/assistant/guide/spatialTour'
import { buildCampusModel, higherEventLevel } from '@/core/spatial/project'
import SpatialScene from './SpatialScene.vue'
import FloorDrawer, { type FloorDrawerFloor } from '@/components/map/FloorDrawer.vue'
import SpatialFacts from './SpatialFacts.vue'
import SpatialTourPanel from './tour/SpatialTourPanel.vue'
import type { PickResult, SceneScope, ViewMode } from './sceneBuild'

export interface SpatialInitial {
  /** campus = 校园 3D（看五栋完整建筑外观）；building = 3D 楼层（进单栋看逐层与传感器） */
  stage: 'campus' | 'building'
  buildingId: string
  floorId: string
  pointId: string
}

const props = defineProps<{
  initial: SpatialInitial
  /**
   * 父级当前的档位（校园 3D / 3D 楼层）。它变化时要**主动重置层级**：
   * 面板是 `v-if` 挂载的，从 2D 切过来时可能在路由落定前就挂载了，
   * 只读一次 `initial` 会拿着上一档的楼栋不放 —— 校园 3D 就永远进不去。
   */
  stage: 'campus' | 'building'
  autoTour?: boolean
  tourEventId?: string
}>()
const emit = defineEmits<{
  /** 选择变化（父级把它写进路由 query） */
  select: [value: SpatialInitial]
  exit: []
  unavailable: [reason: string]
  openTrend: [pointId: string]
  openMedia: [pointId: string]
  openEvent: [eventId: string]
}>()

const archive = useArchiveStore()
const events = useEventsStore()

/**
 * 入场默认进**一栋楼的模型**（而不是全部楼栋体量的校园鸟瞰）：
 * 3D 与 2D 是同一层级的两种看法 —— 2D 已经能在校园图上选楼栋、再进楼层图，
 * 3D 就直接给这栋楼的完整建模，右边选楼层看该层传感器装在哪面墙上。
 * 想看全校体量时用工具栏的「校园总览」。
 */
const fallbackBuildingId = archive.activeBuildings[0]?.id ?? archive.buildings[0]?.id ?? ''
// 校园 3D 档位下**不要**塞进第一栋：那样"看五栋完整建筑外观"就没有入口了（用户报过这一点）
const buildingId = ref(
  props.initial.stage === 'campus'
    ? ''
    : props.initial.buildingId === ''
      ? fallbackBuildingId
      : props.initial.buildingId,
)
const floorId = ref(props.initial.floorId)
const pointId = ref(props.initial.pointId)
const mode = ref<ViewMode>('whole')
const tour = ref<Extract<SpatialTourResult, { ok: true }> | null>(null)
const tourNotice = ref('')
const focusToken = ref(0)
const floorDrawerOpen = ref(props.stage === 'building')
const selectedZoneKey = ref('')

function startTour(auto = false): void {
  const result = buildSpatialTour({
    model: model.value,
    snapshot: buildSnapshot(),
    pointId: auto ? props.initial.pointId : pointId.value,
    eventId: auto ? props.tourEventId ?? '' : '',
  })
  if (!result.ok) {
    tourNotice.value = result.reason
    tour.value = null
    return
  }
  tourNotice.value = ''
  tour.value = result
}

function applyTourStep(step: SpatialTourStep): void {
  if (step.stage === 'campus') {
    buildingId.value = ''
    floorId.value = ''
    pointId.value = ''
    return
  }
  buildingId.value = step.buildingId
  floorId.value = step.stage === 'building' ? '' : step.floorId
  pointId.value = step.focusPoint ? step.pointId : ''
  mode.value = step.stage === 'building' ? 'whole' : 'floor'
  if (step.focusPoint) focusToken.value += 1
}

onMounted(() => { if (props.autoTour) startTour(true) })
watch(() => props.autoTour, (value) => { if (value) startTour(true) })

/** 未关闭事件 → 每个测点的最高等级；没有未关闭事件就不给颜色（不能读成"在线"） */
const eventLevelByPoint = computed<Record<string, EventLevel | null>>(() => {
  const map: Record<string, EventLevel | null> = {}
  for (const row of events.openEvents) {
    map[row.pointId] = higherEventLevel(map[row.pointId] ?? null, row.level)
  }
  return map
})

const model = computed(() => buildCampusModel({
  buildings: archive.buildings,
  floors: archive.floors,
  points: archive.points,
  eventLevelByPoint: eventLevelByPoint.value,
}))

const building = computed(() => model.value.buildings.find((row) => row.building.id === buildingId.value) ?? null)
const scope = computed<SceneScope>(() => (building.value === null ? { kind: 'campus' } : { kind: 'building', buildingId: building.value.building.id }))
const activeLevelIndex = computed(() => {
  const row = building.value
  if (row === null) return 0
  const index = row.levels.findIndex((level) => level.floor?.id === floorId.value)
  return index < 0 ? 0 : index
})
const activeLevel = computed(() => (building.value === null ? null : building.value.levels[activeLevelIndex.value] ?? null))
const selectedPoint = computed(() => {
  if (pointId.value === '') return null
  for (const row of model.value.buildings) {
    for (const level of row.levels) {
      const hit = level.markers.find((marker) => marker.point.id === pointId.value)
      if (hit !== undefined) return { building: row, level, marker: hit }
    }
  }
  return null
})
const selectedDevice = computed(() => archive.devices.find((row) => row.pointId === pointId.value) ?? null)

const breadcrumb = computed(() => {
  const parts = ['校园']
  if (building.value !== null) parts.push(`${building.value.building.code} ${building.value.building.name}`)
  if (activeLevel.value !== null) parts.push(activeLevel.value.name)
  if (selectedPoint.value !== null) parts.push(selectedPoint.value.marker.point.code)
  return parts
})

const levelPoints = computed(() => activeLevel.value?.markers ?? [])

const drawerFloors = computed<FloorDrawerFloor[]>(() =>
  (building.value?.levels ?? []).map((level) => ({
    id: level.floor?.id ?? `level-${level.floorNo}`,
    floorNo: level.floorNo,
    name: level.name,
    built: level.floor !== null,
  })),
)

/**
 * 本层有几个测点在附近找不到可取用的墙面（离墙太远或垂足落在墙段外）。
 * 这些点不硬按到别的房间的墙上：按平面坐标落位，并在这里如实说明。
 */
const offWallCount = computed(() => levelPoints.value.filter((row) => row.mount === null).length)

/**
 * 选中测点的**实时信息摘要**，画在 3D 里那台设备的编号下面。
 * 与事实卡同源（同一份只读快照 + 同一套取值口径），所以模型上的数字和右侧卡片不会打架。
 */
const snapshot = computed(() => buildSnapshot())
const selectedSummary = computed(() => {
  const id = pointId.value
  if (id === '') return ''
  const record = latestValidRecord(snapshot.value.records, id)
  const point = snapshot.value.points.find((row) => row.id === id)
  if (record === null || point === undefined) return '暂无有效读数'
  const text = factsOf(record.values, point.metric).map((row) => `${row.value}${row.unit}`).join(' / ')
  return `${text} · ${formatDateTime(record.sampleTime).slice(5, 16)}`
})

/** 校园层级的规模摘要（放在最上面，让人先知道这套数据有多少对象） */
const campusSummary = computed(() => {
  const floors = model.value.buildings.reduce((sum, row) => sum + row.levels.filter((level) => level.floor !== null).length, 0)
  const points = model.value.buildings.reduce((sum, row) => sum + row.pointCount, 0)
  return `${model.value.buildings.length} 栋 · ${floors} 层 · ${points} 个测点在册`
})

/** 档位切换：校园档清空层级；楼层档落到父级给的楼栋（没有就用第一栋） */
watch(
  () => props.stage,
  (next) => {
    if (next === 'campus') {
      buildingId.value = ''
      floorId.value = ''
      pointId.value = ''
      floorDrawerOpen.value = false
      return
    }
    if (buildingId.value === '') {
      buildingId.value = props.initial.buildingId !== '' ? props.initial.buildingId : fallbackBuildingId
      floorId.value = props.initial.floorId
    }
    floorDrawerOpen.value = true
  },
)

/** 选择变化后把路由同步出去；父级负责写进 query */
watch([buildingId, floorId, pointId], () => {
  emit('select', {
    stage: buildingId.value === '' ? 'campus' : 'building',
    buildingId: buildingId.value,
    floorId: floorId.value,
    pointId: pointId.value,
  })
})

/** 数据集整体替换后清掉已经不存在的选中，避免 3D 里还亮着上一套数据的对象 */
watch(model, (next) => {
  if (buildingId.value !== '' && !next.buildings.some((row) => row.building.id === buildingId.value)) {
    buildingId.value = ''
    floorId.value = ''
    pointId.value = ''
    return
  }
  if (floorId.value !== '' && !next.buildings.some((row) => row.levels.some((level) => level.floor?.id === floorId.value))) {
    floorId.value = ''
    pointId.value = ''
  }
  if (pointId.value !== '' && selectedPoint.value === null) pointId.value = ''
})

function enterBuilding(id: string): void {
  buildingId.value = id
  const row = model.value.buildings.find((item) => item.building.id === id)
  floorId.value = row?.levels.find((level) => level.floor !== null)?.floor?.id ?? ''
  pointId.value = ''
  floorDrawerOpen.value = true
}

function focusLevel(floor: string): void {
  floorId.value = floor
  pointId.value = ''
  selectedZoneKey.value = ''
}

watch(buildingId, (id) => {
  selectedZoneKey.value = ''
  if (id === '') floorDrawerOpen.value = false
})

function onPick(hit: PickResult): void {
  if (hit.zoneKey !== undefined) {
    selectedZoneKey.value = hit.zoneKey
    return
  }
  if (hit.pointId !== '') {
    pointId.value = hit.pointId
    if (hit.floorId !== '') floorId.value = hit.floorId
    if (hit.buildingId !== '') buildingId.value = hit.buildingId
    return
  }
  if (hit.buildingId !== '') enterBuilding(hit.buildingId)
}

const MODE_LABEL: Record<ViewMode, string> = { whole: '整栋', floor: '仅本层', exploded: '竖向展开' }
</script>

<template>
  <div class="spatial">
    <div class="bar">
      <nav class="crumbs" aria-label="3D 面包屑">
        <button type="button" class="crumb" :class="{ 'crumb--on': building === null }" @click="buildingId = ''; floorId = ''; pointId = ''">校园</button>
        <template v-for="(part, index) in breadcrumb.slice(1)" :key="`${part}-${index}`">
          <span class="sep">›</span>
          <span class="crumb crumb--now">{{ part }}</span>
        </template>
      </nav>
      <div class="row wrap tools">
        <button type="button" class="mode tour-launch" @click="startTour(false)">✦ 小瞳带看 3D</button>
        <div class="modes" role="group" aria-label="楼层视图">
          <button
            v-for="(label, key) in MODE_LABEL"
            :key="key"
            type="button"
            class="mode"
            :class="{ 'mode--on': mode === key }"
            :disabled="building === null"
            @click="mode = key"
          >{{ label }}</button>
        </div>
        <button type="button" class="mode" @click="emit('exit')">返回 2D 平面图</button>
      </div>
    </div>

    <p v-if="tourNotice !== ''" class="notice notice--warn">{{ tourNotice }}</p>

    <div class="grid">
      <div class="canvas-box">
        <div class="scene-stage">
          <SpatialScene
          :model="model"
          :scope="scope"
          :mode="mode"
          :active-level-index="activeLevelIndex"
          :selected-point-id="pointId"
          :selected-summary="selectedSummary"
          :selected-zone-key="selectedZoneKey"
          :selected-device="selectedDevice"
          :focus-token="focusToken"
          @pick="onPick"
          @unavailable="emit('unavailable', $event)"
          />
          <SpatialTourPanel
            v-if="tour !== null"
            :steps="tour.steps"
            :point-code="tour.pointCode"
            :event-id="tour.eventId"
            @step="applyTourStep"
            @close="tour = null"
            @open-event="emit('openEvent', $event)"
          />
        </div>
        <p class="muted hint">
          档案驱动的示意模型，非实测图纸或 BIM；测点位置沿用 2D 坐标。墙面圆点用于定位，选中后的线框与芯体为墙内透视示意，实际安装方式和埋深尚未登记。颜色只表示测点类型或未关闭预警，不表示设备在线。
        </p>
        <p class="muted hint">操作：左键旋转 360° · 右键/双指自由平移 · 滚轮缩放；房间名称点击后显示。</p>
        <p v-if="offWallCount > 0" class="muted hint">
          本层有 {{ offWallCount }} 个测点附近没有可取用的墙面，按平面坐标落位（<strong>未贴合墙面</strong>），没有硬按到别的房间的墙上。
        </p>
      </div>

      <aside class="side">
        <!-- 第一级：校园总览。右侧永远从这一级开始，再往下才是楼栋 → 楼层 → 测点。 -->
        <div class="list">
          <p class="block-title">
            校园总览
            <button v-if="building !== null" type="button" class="link" @click="buildingId = ''; floorId = ''; pointId = ''">回到校园视图</button>
          </p>
          <p class="muted">{{ campusSummary }}</p>
          <div class="chips">
            <button
              v-for="row in model.buildings"
              :key="row.building.id"
              type="button"
              class="chip"
              :class="{ 'chip--on': row.building.id === buildingId, 'chip--archived': row.archived }"
              @click="enterBuilding(row.building.id)"
            >
              {{ row.building.code }}
              <span v-if="row.maxEventLevel !== null" class="dot" :class="`dot--${row.maxEventLevel}`" aria-hidden="true" />
              <span v-if="row.archived" class="muted">已归档</span>
            </button>
          </div>
        </div>

        <div v-if="building !== null" class="list">
          <p class="block-title">{{ building.building.code }} {{ building.building.name }} · 楼层</p>
          <div class="floor-launch">
            <span class="muted">当前：{{ activeLevel?.name ?? '未选择' }}</span>
            <button type="button" class="chip" @click="floorDrawerOpen = true">展开楼层抽屉</button>
          </div>
        </div>

        <div v-if="building !== null" class="list">
          <p class="block-title">本层测点</p>
          <p v-if="activeLevel === null || activeLevel.floor === null" class="muted">这一层还没有建档，先在档案页补建楼层。</p>
          <p v-else-if="levelPoints.length === 0" class="muted">本层暂无在册测点。</p>
          <div v-else class="chips">
            <button
              v-for="marker in levelPoints"
              :key="marker.point.id"
              type="button"
              class="chip"
              :class="{ 'chip--on': marker.point.id === pointId, 'chip--archived': marker.archived }"
              @click="pointId = marker.point.id"
            >
              {{ marker.point.code }}
              <span v-if="marker.eventLevel !== null" class="dot" :class="`dot--${marker.eventLevel}`" aria-hidden="true" />
            </button>
          </div>
        </div>

        <SpatialFacts
          :point-id="pointId"
          :mount="selectedPoint?.marker.mount ?? null"
          :mount-height="selectedPoint?.marker.mountHeight ?? null"
          @open-trend="emit('openTrend', $event)"
          @open-media="emit('openMedia', $event)"
        />
      </aside>
    </div>

    <FloorDrawer
      :open="floorDrawerOpen"
      :building-code="building?.building.code ?? ''"
      :building-name="building?.building.name ?? ''"
      :floors="drawerFloors"
      :active-floor-id="floorId"
      @open="floorDrawerOpen = true"
      @close="floorDrawerOpen = false"
      @select-floor="focusLevel"
    />
  </div>
</template>

<style scoped>
.spatial { display: grid; gap: 10px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.crumbs { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.crumb { border: 0; background: none; padding: 0; color: var(--brand-700); cursor: pointer; font: inherit; }
.crumb--now { color: var(--text-2); cursor: default; }
.sep { color: var(--text-3); }
.tools { display: flex; gap: 6px; align-items: center; }
.modes { display: flex; gap: 4px; }
.mode {
  height: 26px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
  background: var(--paper); color: var(--text-2); font-size: 12px; cursor: pointer;
}
.mode--on { background: var(--brand-050); border-color: var(--brand-600); color: var(--brand-700); font-weight: 600; }
.grid { display: grid; grid-template-columns: minmax(0, 2.4fr) minmax(240px, 1fr); gap: 14px; align-items: start; }
.canvas-box { display: grid; gap: 8px; height: clamp(470px, 62vh, 640px); grid-template-rows: minmax(0, 1fr) auto; }
.scene-stage { position: relative; min-height: 0; }
.tour-launch { border-color: #0c8290; color: #086977; font-weight: 700; }
.hint { margin: 0; font-size: 11.5px; }
.side { display: grid; gap: 10px; align-content: start; }
.block-title { margin: 0 0 4px; font-size: 12px; font-weight: 700; color: var(--text-2); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.link { border: 0; background: none; padding: 0; color: var(--brand-700); font: inherit; font-size: 11.5px; font-weight: 400; cursor: pointer; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.floor-launch { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0 4px; }
.chip {
  display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px;
  border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--paper);
  color: var(--text-2); font-size: 12px; cursor: pointer;
}
.chip:focus-visible, .crumb:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
.chip--on { background: var(--brand-050); border-color: var(--brand-600); color: var(--brand-700); font-weight: 600; }
.chip--off { opacity: .7; cursor: not-allowed; }
.chip--archived { border-style: dashed; }
.muted { color: var(--text-3); font-size: 11.5px; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot--red { background: #c0392b; }
.dot--orange { background: #d97b18; }
.dot--yellow { background: #c9a227; }
@media (max-width: 1180px) {
  .grid { grid-template-columns: minmax(0, 1fr); }
  .canvas-box { height: clamp(420px, 58vh, 540px); }
}
</style>

<script setup lang="ts">
/** 校园地图钻取：校园图 → 楼层图 → 测点详情，可在本页直接录入数据与设置基准。 */
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Point } from '@/types/domain'
import { hasNumericReadings, metricDef, pointTypeDef } from '@/types/catalog'
import { PLACEHOLDER_NOTICE } from '@/config/notices'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { fillGaps, fmtNumber } from '@/core/format'
import { resolveSpatialTarget, spatialQueryOf, stageOf, type SpatialFacts, type SpatialStage } from '@/core/spatial/selection'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import DescList from '@/components/ui/info/DescList.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import CampusMap from '@/components/map/CampusMap.vue'
import FloorMap from '@/components/map/FloorMap.vue'
import type { SpatialInitial } from '@/components/map/spatial/SpatialPanel.vue'
import PointDetailPanel from '@/components/panels/PointDetailPanel.vue'
import RecordDialog from '@/components/dialogs/RecordDialog.vue'
import BaselineDialog from '@/components/dialogs/BaselineDialog.vue'

const SpatialPanel = defineAsyncComponent(() => import('@/components/map/spatial/SpatialPanel.vue'))

const route = useRoute()
const router = useRouter()
const archive = useArchiveStore()
const records = useRecordsStore()

/**
 * 视图三档：2D 平面（默认）／校园 3D（看四栋完整建筑外观）／3D 楼层（进单栋看逐层与传感器）。
 * 都只是同一份档案的不同看法，不改档案、不写库。
 */
const stage = ref<SpatialStage>('2d')
const view3d = computed(() => stage.value !== '2d')
const spatialNotice = ref('')
const spatialInitial = ref<SpatialInitial>({ stage: 'campus', buildingId: '', floorId: '', pointId: '' })

const selectedBuildingId = ref('')
const selectedFloorId = ref('')
const selectedPointId = ref('')
const recordOpen = ref(false)
const recordPointId = ref<string | null>(null)
const baselinePoint = ref<Point | null>(null)

const building = computed(() => archive.buildingById(selectedBuildingId.value) ?? null)
const floors = computed(() => (building.value === null ? [] : archive.floorsOf(building.value.id)))
const floor = computed(() => archive.floorById(selectedFloorId.value) ?? null)
const floorPoints = computed(() => (floor.value === null ? [] : archive.pointsOfFloor(floor.value.id, true)))
const selectedPoint = computed(() => archive.pointById(selectedPointId.value) ?? null)
const levelLabel = computed(() => (building.value === null ? '' : `${building.value.name} ${floor.value?.name ?? ''}`.trim()))

const badges = computed(() => {
  const map: Record<string, number> = {}
  for (const row of archive.buildings) map[row.id] = archive.pointsOfBuilding(row.id).length
  return map
})

function pickBuilding(): void {
  const fromQuery = typeof route.query.b === 'string' ? route.query.b : ''
  if (fromQuery !== '' && archive.buildingById(fromQuery) !== undefined) {
    selectedBuildingId.value = fromQuery
    return
  }
  if (archive.buildingById(selectedBuildingId.value) === undefined) {
    selectedBuildingId.value = archive.activeBuildings[0]?.id ?? ''
  }
}

watch(() => route.query, syncFromRoute)
onMounted(() => {
  pickBuilding()
  syncFromRoute()
})

watch(
  floors,
  (list) => {
    if (!list.some((row) => row.id === selectedFloorId.value)) {
      selectedFloorId.value = list[0]?.id ?? ''
      selectedPointId.value = ''
    }
  },
  { immediate: true },
)

const buildingItems = computed(() => {
  const row = building.value
  if (row === null) return []
  return [
    { label: '楼栋编号', value: row.code, mono: true },
    { label: '用途', value: fillGaps(row.purpose) },
    { label: '结构形式', value: fillGaps(row.structureType) },
    { label: '建设年份', value: row.buildYear === null ? '待补充' : String(row.buildYear), mono: true },
    { label: '层数 / 面积', value: `${row.floorCount ?? '待补充'} 层 / ${row.area === null ? '待补充' : `${row.area} ㎡`}` },
    { label: '管理单位', value: fillGaps(row.managerUnit) },
    { label: '楼栋负责人', value: fillGaps(row.owner) },
    { label: '替补人员', value: fillGaps(row.backupPerson) },
    { label: '资料来源', value: fillGaps(row.source), wide: true },
  ]
})

const missing = computed(() => (building.value === null ? [] : archive.missingOfBuilding(building.value)))

function latestText(point: Point): string {
  if (!hasNumericReadings(point.metric)) return '人工检查'
  const record = records.latestOfPoint(point.id)
  if (record === undefined) return '暂无记录'
  const def = metricDef(point.metric)
  return def.fields
    .map((field) => `${fmtNumber(record.values[field.key] ?? null, field.digits)}${field.unit}`)
    .join(' / ')
}

function openRecord(pointId: string): void {
  recordPointId.value = pointId
  recordOpen.value = true
}

function openBaseline(pointId: string): void {
  baselinePoint.value = archive.pointById(pointId) ?? null
}

/** 深链复核用的事实查询：一个 ID 只会命中楼栋/楼层/测点其中之一 */
function factsOf(id: string): SpatialFacts {
  const building = archive.buildingById(id)
  if (building !== undefined) return { building: { code: building.code, name: building.name, status: building.status } }
  const floor = archive.floorById(id)
  if (floor !== undefined) return { floor: { name: floor.name, buildingId: floor.buildingId, status: floor.status } }
  const point = archive.pointById(id)
  if (point !== undefined) {
    return { point: { code: point.code, buildingId: point.buildingId, floorId: point.floorId, status: point.status } }
  }
  return {}
}

/** 把路由 query 复核成"能打开的选择"：找不到、已归档、归属对不上都会清掉并给出原因 */
function syncFromRoute(): void {
  const target = resolveSpatialTarget(route.query, factsOf)
  stage.value = stageOf(target)
  spatialNotice.value = target.reason
  // 3D 楼层档：链接没点名楼栋/楼层时，沿用 2D 当前钻取到的那一栋那一层；
  // 校园 3D 档不看楼栋，直接就是四栋外观。
  spatialInitial.value = {
    stage: stage.value === 'campus' ? 'campus' : 'building',
    buildingId: stage.value === 'campus'
      ? ''
      : target.buildingId !== '' ? target.buildingId : selectedBuildingId.value,
    floorId: stage.value === 'campus'
      ? ''
      : target.floorId !== '' ? target.floorId : selectedFloorId.value,
    pointId: stage.value === 'campus' ? '' : target.pointId,
  }
  if (target.buildingId !== '') selectedBuildingId.value = target.buildingId
  if (target.floorId !== '') selectedFloorId.value = target.floorId
  if (target.pointId !== '') selectedPointId.value = target.pointId
}

function setView(next: SpatialStage): void {
  // 先备好初始选择，再切档位：面板是 v-if 挂载的，顺序反了会先按旧值挂上去
  if (next === 'campus') spatialInitial.value = { stage: 'campus', buildingId: '', floorId: '', pointId: '' }
  stage.value = next
  spatialNotice.value = ''
  void router.replace({
    query: spatialQueryOf({
      view: next === '2d' ? '2d' : '3d',
      // 校园 3D 不带楼栋参数：带了就变成"进单栋"了
      buildingId: next === '2d' ? selectedBuildingId.value : next === 'building' ? selectedBuildingId.value : '',
      floorId: next === 'building' ? selectedFloorId.value : '',
      pointId: next === 'building' ? selectedPointId.value : '',
    }),
  })
}

/** 3D 里换了选择就同步进地址栏，链接与画面始终指同一个对象 */
function onSpatialSelect(value: SpatialInitial): void {
  if (value.buildingId !== '') selectedBuildingId.value = value.buildingId
  selectedFloorId.value = value.floorId
  selectedPointId.value = value.pointId
  stage.value = value.stage
  void router.replace({
    query: { ...spatialQueryOf({
      view: '3d',
      buildingId: value.buildingId,
      floorId: value.stage === 'building' ? value.floorId : '',
      pointId: value.stage === 'building' ? value.pointId : '',
    }), ...(route.query.tour === '1' ? { tour: '1', event: String(route.query.event ?? '') } : {}) },
  })
}

function fallbackTo2d(reason: string): void {
  setView('2d')
  // setView 会先清掉旧提示，失败原因必须在它之后再写进去，否则用户看不到为什么退回 2D
  spatialNotice.value = reason
}
</script>

<template>
  <div class="stack">
    <details class="map-scope">
      <summary><b>地图与模型说明</b> · 档案示意，2D 与 3D 共用位置</summary>
      <p class="notice notice--warn"><b>数据口径：</b>{{ PLACEHOLDER_NOTICE }}</p>
    <p class="notice notice--brand">
      <b>定位路径：</b>校园图选楼栋 → 楼层图选测点 → 查看档案与最近读数。底图与坐标为示意值，接入真实校园图时替换底图并递增底图版本，测点坐标约定不变。
    </p>
    </details>
    <p v-if="records.lastEventMessage !== ''" class="notice notice--brand">
      <b>上一条记录的预警结果：</b>{{ records.lastEventMessage }}
      <RouterLink class="link" to="/alarms">到预警中心查看</RouterLink>
    </p>

    <p v-if="spatialNotice !== ''" class="notice notice--warn">
      <b>3D 链接：</b>{{ spatialNotice }}
    </p>

    <div class="row wrap view-switch">
      <span class="muted">地图视图</span>
      <button type="button" class="view-btn" :class="{ 'view-btn--on': stage === '2d' }" @click="setView('2d')">2D 平面</button>
      <button type="button" class="view-btn" :class="{ 'view-btn--on': stage === 'campus' }" @click="setView('campus')">校园 3D</button>
      <button type="button" class="view-btn" :class="{ 'view-btn--on': stage === 'building' }" @click="setView('building')">3D 楼层</button>
    </div>

    <SectionCard
      v-if="view3d"
      :title="stage === 'campus' ? '校园 3D' : '3D 楼层'"
      :sub="stage === 'campus'
        ? '四栋建筑的完整外观模型，位置按楼栋档案的校园占位摆放，与 2D 校园图一一对应；点楼栋进入楼层视图'
        : '按档案生成的演示示意：校园 → 楼栋 → 楼层 → 测点；选中的对象与小瞳、看板用同一个编号'"
      marked
    >
      <SpatialPanel
        :initial="spatialInitial"
        :stage="stage === 'campus' ? 'campus' : 'building'"
        :auto-tour="route.query.tour === '1'"
        :tour-event-id="typeof route.query.event === 'string' ? route.query.event : ''"
        @select="onSpatialSelect"
        @exit="setView('2d')"
        @unavailable="fallbackTo2d"
        @open-trend="(id) => router.push({ path: '/trend', query: { point: id } })"
        @open-media="(id) => router.push({ path: '/media', query: { point: id } })"
        @open-event="(id) => router.push({ path: '/alarms', query: { event: id } })"
      />
    </SectionCard>

    <div class="two" :class="{ 'two--single': view3d }">
      <SectionCard v-if="!view3d" title="校园平面图" sub="点击楼栋进入，图上区分实测建档与示例数据" marked>
        <CampusMap
          :buildings="archive.buildings"
          :badges="badges"
          :active-id="selectedBuildingId"
          :height="456"
          @select="
            (id) => {
              selectedBuildingId = id
              selectedPointId = ''
            }
          "
        />
      </SectionCard>

      <SectionCard :title="building === null ? '楼栋档案' : `${building.code} ${building.name}`" sub="点击楼层标签切换楼层图">
        <EmptyState v-if="building === null" title="尚未选择楼栋" sub="在左侧校园图上点击任意楼栋" />
        <template v-else>
          <div class="row wrap head-row">
            <StatusTag :tone="building.dataSource === 'real' ? 'green' : 'gray'" :text="building.dataSource === 'real' ? '实测建档' : '示例数据'" />
            <StatusTag v-if="building.status === 'archived'" tone="gray" text="已归档" />
            <StatusTag tone="brand" :text="`${floors.length} 个楼层`" :dot="false" />
          </div>

          <p v-if="missing.length > 0" class="notice notice--warn">
            档案待补充：{{ missing.join('、') }}。缺失项按“待补充”显示，不用空值或零值冒充完整档案。
          </p>

          <DescList :items="buildingItems" />

          <div class="tabs">
            <button
              v-for="row in floors"
              :key="row.id"
              type="button"
              class="tab"
              :class="{ 'tab--on': row.id === selectedFloorId }"
              @click="
                () => {
                  selectedFloorId = row.id
                  selectedPointId = ''
                }
              "
            >
              {{ row.name }}
            </button>
            <span v-if="floors.length === 0" class="muted">该楼栋尚未建立楼层</span>
          </div>

          <DataTable
            :columns="[
              { key: 'code', label: '测点编号', width: '132px' },
              { key: 'name', label: '名称' },
              { key: 'latest', label: '最新读数', align: 'right', width: '104px' },
              { key: 'count', label: '记录', width: '56px', align: 'right' },
            ]"
            :row-count="floorPoints.length"
            empty="当前楼层暂无测点"
          >
            <tr
              v-for="point in floorPoints"
              :key="point.id"
              class="clickable"
              :class="{ 'row--on': point.id === selectedPointId }"
              @click="selectedPointId = point.id"
            >
              <td class="code">{{ point.code }}</td>
              <td class="col-main">
                <div>{{ point.name }}</div>
                <div class="code">{{ pointTypeDef(point.type).name }}</div>
              </td>
              <td class="ta-r num">{{ latestText(point) }}</td>
              <td class="ta-r num">{{ records.countOfPoint(point.id) }}</td>
            </tr>
          </DataTable>
        </template>
      </SectionCard>
    </div>

    <div class="two">
      <SectionCard v-if="!view3d" title="楼层平面图" :sub="levelLabel === '' ? '按区域名称生成的示意平面' : `${levelLabel}｜点击测点标记查看详情`">
        <FloorMap
          :floor="floor"
          :points="floorPoints"
          :level-label="levelLabel"
          :active-point-id="selectedPointId"
          :height="420"
          @select="selectedPointId = $event"
        />
      </SectionCard>

      <PointDetailPanel :point="selectedPoint" @record="openRecord" @baseline="openBaseline" />
    </div>

    <RecordDialog :open="recordOpen" :point-id="recordPointId" :record="null" @close="recordOpen = false" />
    <BaselineDialog
      :open="baselinePoint !== null"
      :point="baselinePoint"
      @close="baselinePoint = null"
    />
  </div>
</template>

<style scoped>
.map-scope { padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper); color: var(--text-2); font-size: 12px; }
.map-scope summary { cursor: pointer; }.map-scope summary b { color: var(--text); }.map-scope .notice { margin-top: 12px; }
.two {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

/* 3D 视角下地图块让位给 3D 工作区，档案块改为整行 */
.two--single {
  grid-template-columns: minmax(0, 1fr);
}

.view-switch {
  display: flex;
  align-items: center;
  gap: 6px;
}

.view-btn {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}

.view-btn:hover {
  border-color: var(--brand-500);
  color: var(--brand-700);
}

.view-btn--on {
  background: var(--brand-050);
  border-color: var(--brand-600);
  color: var(--brand-700);
  font-weight: 600;
}

.head-row {
  margin-bottom: 12px;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 14px 0 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.tab {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}

.tab:hover {
  border-color: var(--brand-500);
  color: var(--brand-700);
}

.tab--on {
  background: var(--brand-050);
  border-color: var(--brand-600);
  color: var(--brand-700);
  font-weight: 600;
}

.clickable {
  cursor: pointer;
}

.row--on {
  background: var(--brand-050);
}

@media (max-width: 1180px) {
  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

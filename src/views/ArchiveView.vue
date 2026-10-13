<script setup lang="ts">
/** 建筑与设备：楼栋列表 + 楼栋档案、楼层、楼层图、测点与设备建档。 */
import { computed, onMounted, ref, watch } from 'vue'
import type { Building, Floor } from '@/types/domain'
import { useArchiveStore } from '@/stores/archive'
import { setArchived, type ArchiveTarget } from '@/stores/writes/archiveActions'
import { fillGaps } from '@/core/format'
import { PLACEHOLDER_NOTICE } from '@/config/notices'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import DescList from '@/components/ui/info/DescList.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FloorMap from '@/components/map/FloorMap.vue'
import { useRoute } from 'vue-router'
import PointDevicePanel from '@/components/panels/PointDevicePanel.vue'
import BuildingDialog from '@/components/dialogs/BuildingDialog.vue'
import FloorDialog from '@/components/dialogs/FloorDialog.vue'
import ArchiveDialog from '@/components/dialogs/ArchiveDialog.vue'

const archive = useArchiveStore()

const keyword = ref('')
const route = useRoute()
/** 保养页「设备离线」分区深链过来时只看离线设备 */
const offlineOnly = computed(() => route.query.health === 'offline')
const includeArchived = ref(false)
const selectedId = ref('')
const selectedFloorId = ref('')
const message = ref('')
const messageTone = ref<'ok' | 'bad'>('ok')

const buildingOpen = ref(false)
const buildingEditing = ref<Building | null>(null)
const floorOpen = ref(false)
const floorEditing = ref<Floor | null>(null)
const archiveTarget = ref<{ target: ArchiveTarget; id: string; label: string } | null>(null)

const list = computed(() => {
  const text = keyword.value.trim()
  return [...archive.buildings]
    .filter((row) => includeArchived.value || row.status === 'active')
    .filter((row) => text === '' || row.name.includes(text) || row.code.includes(text))
    .sort((a, b) => a.code.localeCompare(b.code))
})

const building = computed(() => archive.buildingById(selectedId.value) ?? null)
const floors = computed(() => (building.value === null ? [] : archive.floorsOf(building.value.id, true)))
const activeFloors = computed(() => floors.value.filter((row) => row.status === 'active'))
const floor = computed(() => archive.floorById(selectedFloorId.value) ?? null)
const floorPoints = computed(() => (floor.value === null ? [] : archive.pointsOfFloor(floor.value.id, true)))
const levelLabel = computed(() => (building.value === null ? '' : `${building.value.name} ${floor.value?.name ?? ''}`.trim()))
const missing = computed(() => (building.value === null ? [] : archive.missingOfBuilding(building.value)))

const buildingItems = computed(() => {
  const row = building.value
  if (row === null) return []
  return [
    { label: '楼栋编号', value: row.code, mono: true },
    { label: '用途', value: fillGaps(row.purpose) },
    { label: '建设年份', value: row.buildYear === null ? '待补充' : String(row.buildYear), mono: true },
    { label: '层数', value: row.floorCount === null ? '待补充' : `${row.floorCount} 层` },
    { label: '建筑面积', value: row.area === null ? '待补充' : `${row.area} ㎡` },
    { label: '结构形式', value: fillGaps(row.structureType) },
    { label: '管理单位', value: fillGaps(row.managerUnit) },
    { label: '使用单位', value: fillGaps(row.userUnit) },
    { label: '楼栋负责人', value: fillGaps(row.owner) },
    { label: '值班联系电话', value: fillGaps(row.ownerPhone) },
    { label: '替补人员', value: fillGaps(row.backupPerson) },
    { label: '资料来源', value: fillGaps(row.source) },
    { label: '图上位置', value: `X ${row.footprint.x.toFixed(3)} / Y ${row.footprint.y.toFixed(3)}`, mono: true, wide: true },
  ]
})

function notify(text: string, tone: 'ok' | 'bad'): void {
  message.value = text
  messageTone.value = tone
}

function pickFirst(): void {
  if (archive.buildingById(selectedId.value) === undefined) {
    selectedId.value = archive.activeBuildings[0]?.id ?? ''
  }
}

onMounted(pickFirst)
/*
 * 盯 id 列表而不是栋数：恢复备份时栋数可能相同而 id 全换，
 * 只看长度会让 selectedId 指向一个已不存在的楼栋，详情区静默显示"尚未选择"。
 */
watch(
  () => archive.buildings.map((row) => row.id).join('|'),
  pickFirst,
)

watch(
  activeFloors,
  (rows) => {
    if (!rows.some((row) => row.id === selectedFloorId.value)) {
      selectedFloorId.value = rows[0]?.id ?? ''
    }
  },
  { immediate: true },
)

function openBuilding(row: Building | null): void {
  buildingEditing.value = row
  buildingOpen.value = true
}

function openFloor(row: Floor | null): void {
  floorEditing.value = row
  floorOpen.value = true
}

function askArchive(target: ArchiveTarget, id: string, label: string): void {
  archiveTarget.value = { target, id, label }
}

function isArchived(target: { target: ArchiveTarget; id: string }): boolean {
  if (target.target === 'building') return archive.buildingById(target.id)?.status === 'archived'
  return archive.floorById(target.id)?.status === 'archived'
}

async function confirmArchive(reason: string): Promise<void> {
  const target = archiveTarget.value
  if (target === null) return
  const result = await setArchived(target.target, target.id, !isArchived(target), reason)
  notify(result.message === '' ? '操作完成' : result.message, result.ok ? 'ok' : 'bad')
  archiveTarget.value = null
}
</script>

<template>
  <div class="stack">
    <p class="notice notice--warn"><b>数据口径：</b>{{ PLACEHOLDER_NOTICE }}</p>

    <p v-if="message !== ''" class="notice" :class="messageTone === 'ok' ? 'notice--brand' : 'notice--warn'">
      {{ message }}
    </p>

    <div class="layout">
      <SectionCard title="楼栋清单" :sub="`共 ${list.length} 栋`">
        <template #actions>
          <AppButton size="sm" variant="primary" @click="openBuilding(null)">新建楼栋</AppButton>
        </template>
        <input v-model="keyword" class="ctl" type="search" placeholder="搜索楼栋编号或名称" />
        <label class="toggle">
          <input v-model="includeArchived" type="checkbox" />
          含已归档
        </label>
        <ul class="bld-list">
          <li
            v-for="row in list"
            :key="row.id"
            class="bld-item"
            :class="{ 'bld-item--on': row.id === selectedId }"
            @click="selectedId = row.id"
          >
            <div class="row-between">
              <span class="bld-name">{{ row.name }}</span>
              <StatusTag
                :tone="row.status === 'archived' ? 'gray' : row.dataSource === 'real' ? 'green' : 'brand'"
                :text="row.status === 'archived' ? '已归档' : row.dataSource === 'real' ? '实测' : '示例'"
              />
            </div>
            <div class="code">{{ row.code }}｜{{ archive.pointsOfBuilding(row.id, true).length }} 个测点</div>
          </li>
        </ul>
        <EmptyState v-if="list.length === 0" title="暂无楼栋" sub="点击「新建楼栋」开始空白建档" />
      </SectionCard>

      <div class="stack">
        <SectionCard title="楼栋档案" :sub="building === null ? '从左侧选择楼栋' : `${building.code} ${building.name}`" marked>
          <template #actions>
            <template v-if="building !== null">
              <AppButton size="sm" @click="openBuilding(building)">编辑档案</AppButton>
              <AppButton
                size="sm"
                :variant="building.status === 'active' ? 'danger' : 'primary'"
                @click="askArchive('building', building.id, `${building.code} ${building.name}`)"
              >
                {{ building.status === 'active' ? '归档' : '恢复' }}
              </AppButton>
            </template>
          </template>

          <EmptyState v-if="building === null" title="尚未选择楼栋" sub="新建楼栋时需要同时在校园图上落位" />
          <template v-else>
            <p v-if="missing.length > 0" class="notice notice--warn">
              档案待补充：{{ missing.join('、') }}。缺失字段保留为空并纳入建档待办，不用零值代替。
            </p>
            <DescList :items="buildingItems" :columns="2" />
          </template>
        </SectionCard>

        <SectionCard title="楼层档案" sub="楼层图由区域名称生成；底图换版需递增版本并重新核对测点位置">
          <template #actions>
            <AppButton size="sm" :disabled="building === null || building.status === 'archived'" @click="openFloor(null)">
              新建楼层
            </AppButton>
          </template>
          <DataTable
            :columns="[
              { key: 'no', label: '楼层号', width: '80px' },
              { key: 'name', label: '名称', width: '100px' },
              { key: 'zones', label: '区域数量', width: '90px', align: 'right' },
              { key: 'points', label: '测点', width: '70px', align: 'right' },
              { key: 'version', label: '底图版本', width: '90px' },
              { key: 'status', label: '状态', width: '86px' },
              { key: 'ops', label: '操作', width: '150px' },
            ]"
            :row-count="floors.length"
            empty="该楼栋尚未建立楼层"
          >
            <tr
              v-for="row in floors"
              :key="row.id"
              class="clickable"
              :class="{ 'row--on': row.id === selectedFloorId }"
              @click="selectedFloorId = row.id"
            >
              <td class="num">F{{ row.floorNo }}</td>
              <td>{{ row.name }}</td>
              <td class="ta-r num">{{ row.zones.length }}</td>
              <td class="ta-r num">{{ archive.pointsOfFloor(row.id, true).length }}</td>
              <td class="num">v{{ row.planVersion }}</td>
              <td>
                <StatusTag :tone="row.status === 'active' ? 'green' : 'gray'" :text="row.status === 'active' ? '在册' : '已归档'" />
              </td>
              <td>
                <div class="ops">
                  <AppButton size="sm" variant="ghost" @click.stop="openFloor(row)">编辑</AppButton>
                  <AppButton size="sm" variant="ghost" @click.stop="askArchive('floor', row.id, `${row.name}`)">
                    {{ row.status === 'active' ? '归档' : '恢复' }}
                  </AppButton>
                </div>
              </td>
            </tr>
          </DataTable>
        </SectionCard>

        <SectionCard title="楼层平面图" :sub="levelLabel === '' ? '选择楼层后显示' : levelLabel">
          <FloorMap v-if="building !== null" :floor="floor" :points="floorPoints" :level-label="levelLabel" :height="400" />
          <EmptyState v-else title="尚未选择楼栋" sub="选择楼栋后可查看楼层平面图" />
        </SectionCard>

        <p v-if="offlineOnly" class="notice notice--brand">
          只看离线设备（来自「设备离线」分区的深链）：设备表只列出健康状况为「离线 / 待排查」的在册设备，
          已归档设备不计入。先选楼栋，再按需选楼层。
        </p>
        <PointDevicePanel
          v-if="building !== null"
          :building-id="building.id"
          :floor-id="floor?.id ?? null"
          :offline-only="offlineOnly"
        />
        <EmptyState v-else title="测点与设备" sub="选择楼栋后管理该楼栋的测点与设备档案" />
      </div>
    </div>

    <BuildingDialog
      :open="buildingOpen"
      :building="buildingEditing"
      @close="buildingOpen = false"
      @saved="
        (id) => {
          selectedId = id
          notify('楼栋档案已保存', 'ok')
        }
      "
    />
    <FloorDialog
      :open="floorOpen"
      :floor="floorEditing"
      :default-building-id="selectedId"
      @close="floorOpen = false"
      @saved="notify('楼层档案已保存', 'ok')"
    />
    <ArchiveDialog
      :open="archiveTarget !== null"
      :target-label="archiveTarget?.label ?? ''"
      :archived="archiveTarget !== null && !isArchived(archiveTarget)"
      @close="archiveTarget = null"
      @confirm="confirmArchive"
    />
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.bld-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 560px;
  overflow-y: auto;
}

.bld-item {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  cursor: pointer;
}

.bld-item:hover {
  border-color: var(--brand-500);
}

.bld-item--on {
  background: var(--brand-050);
  border-color: var(--brand-600);
}

.bld-name {
  font-size: 13.5px;
  font-weight: 600;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
}

.clickable {
  cursor: pointer;
}

.row--on {
  background: var(--brand-050);
}

.ops {
  display: flex;
  gap: 2px;
}

@media (max-width: 1180px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script setup lang="ts">
/** 校园总览：全校规模、地图入口、最近录入与档案待补充事项。 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { MonitorRecord } from '@/types/domain'
import { metricDef, qualityLabel } from '@/types/catalog'
import { PLACEHOLDER_NOTICE } from '@/config/notices'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import CampusMap from '@/components/map/CampusMap.vue'
import RecordDialog from '@/components/dialogs/RecordDialog.vue'
import { ref } from 'vue'

const router = useRouter()
const archive = useArchiveStore()
const records = useRecordsStore()

const quickRecordOpen = ref(false)

const recentRecords = computed(() => records.recent(9))
const activeBuildingCount = computed(() => archive.activeBuildings.length)
const baselineCount = computed(() => archive.stats.baselines)

const badges = computed(() => {
  const map: Record<string, number> = {}
  for (const building of archive.buildings) {
    map[building.id] = archive.pointsOfBuilding(building.id).length
  }
  return map
})

const pendingArchive = computed(() =>
  archive.activeBuildings
    .map((building) => ({ building, missing: archive.missingOfBuilding(building) }))
    .filter((item) => item.missing.length > 0),
)

const pendingTotal = computed(() => pendingArchive.value.reduce((sum, item) => sum + item.missing.length, 0))

function recordPointLabel(record: MonitorRecord): string {
  return archive.pointLabel(record.pointId)
}

function recordValueText(record: MonitorRecord): string {
  const def = metricDef(record.metric)
  return def.fields
    .map((field) => `${fmtNumber(record.values[field.key] ?? null, field.digits)}${field.unit}`)
    .join(' / ')
}

function qualityTone(record: MonitorRecord): 'green' | 'orange' | 'red' {
  if (record.quality === 'valid') return 'green'
  return record.quality === 'suspect' ? 'orange' : 'red'
}

function openBuilding(id: string): void {
  router.push({ path: '/campus', query: { b: id } })
}
</script>

<template>
  <div class="stack">
    <p class="notice notice--warn"><b>数据口径：</b>{{ PLACEHOLDER_NOTICE }}</p>
    <div class="grid-4">
      <div class="kpi">
        <div class="kpi-label">在册楼栋</div>
        <div class="kpi-value">{{ activeBuildingCount }}</div>
        <div class="kpi-foot">另有已归档 {{ archive.stats.archivedBuildings }} 栋</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">在册测点</div>
        <div class="kpi-value">{{ archive.stats.points }}</div>
        <div class="kpi-foot">
          传感器 {{ archive.stats.sensorPoints }}｜人工检查点 {{ archive.stats.manualPoints }}｜分布 {{ archive.stats.floors }} 个楼层
        </div>
      </div>
      <div class="kpi">
        <div class="kpi-label">登记设备</div>
        <div class="kpi-value">{{ archive.stats.devices }}</div>
        <div class="kpi-foot">设备状态为人工登记，未接入自动心跳</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">监测记录</div>
        <div class="kpi-value">{{ records.total }}</div>
        <div class="kpi-foot">
          已设基准 {{ baselineCount }}｜存疑或无效 {{ records.suspectCount }}｜已修订 {{ records.revisedCount }}
        </div>
      </div>
    </div>

    <div class="two">
      <SectionCard title="校园平面图" sub="点击楼栋进入楼层图，逐级定位到测点；图上区分实测建档与示例数据" marked>
        <template #actions>
          <StatusTag tone="brand" text="归一化示意坐标" :dot="false" />
          <AppButton size="sm" @click="quickRecordOpen = true">快捷录入</AppButton>
        </template>
        <CampusMap
          :buildings="archive.buildings"
          :badges="badges"
          :height="404"
          @select="openBuilding"
        />
      </SectionCard>

      <SectionCard title="最近录入" sub="按采样时间倒序，最多显示 9 条">
        <template #actions>
          <AppButton size="sm" variant="ghost" @click="router.push('/monitor')">全部记录</AppButton>
        </template>
        <DataTable
          :columns="[
            { key: 'time', label: '采样时间', width: '138px' },
            { key: 'point', label: '测点' },
            { key: 'value', label: '读数', align: 'right' },
            { key: 'quality', label: '质量', width: '76px' },
          ]"
          :row-count="recentRecords.length"
          empty="尚无监测记录，先到「监测数据」页录入第一条数据"
        >
          <tr v-for="record in recentRecords" :key="record.id">
            <td class="num">{{ formatDateTime(record.sampleTime) }}</td>
            <td>
              <div class="cell-main">{{ recordPointLabel(record) }}</div>
              <div class="code">{{ record.recordNo }}｜{{ record.enteredBy }}</div>
            </td>
            <td class="ta-r num">{{ recordValueText(record) }}</td>
            <td><StatusTag :tone="qualityTone(record)" :text="qualityLabel(record.quality)" /></td>
          </tr>
        </DataTable>
      </SectionCard>
    </div>

    <div class="two">
      <SectionCard title="档案待补充" :sub="`共 ${pendingTotal} 项字段待补充，缺失项不填零、不臆造`">
        <EmptyState v-if="pendingArchive.length === 0" title="档案字段完整" sub="全部在册楼栋的必填档案字段均已填写" />
        <ul v-else class="pending-list">
          <li v-for="item in pendingArchive" :key="item.building.id">
            <div class="row-between">
              <span class="cell-main">{{ item.building.code }} {{ item.building.name }}</span>
              <AppButton size="sm" variant="ghost" @click="openBuilding(item.building.id)">去补充</AppButton>
            </div>
            <div class="chips">
              <span v-for="label in item.missing" :key="label" class="chip">{{ label }}</span>
            </div>
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="操作日志" sub="记录谁在何时对哪个对象做了什么，导出报告同时留痕">
        <DataTable
          :columns="[
            { key: 'at', label: '时间', width: '138px' },
            { key: 'actor', label: '操作人', width: '150px' },
            { key: 'summary', label: '操作内容' },
          ]"
          :row-count="Math.min(archive.audits.length, 8)"
          empty="暂无操作记录"
        >
          <tr v-for="entry in archive.audits.slice(0, 8)" :key="entry.id">
            <td class="num">{{ formatDateTime(entry.at) }}</td>
            <td>
              <div class="cell-main">{{ entry.actor }}</div>
              <div class="code">{{ entry.actorRole }}</div>
            </td>
            <td>
              <div>{{ entry.summary }}</div>
              <div v-if="entry.reason !== ''" class="code">原因：{{ entry.reason }}</div>
            </td>
          </tr>
        </DataTable>
      </SectionCard>
    </div>

    <RecordDialog
      :open="quickRecordOpen"
      :point-id="null"
      :record="null"
      @close="quickRecordOpen = false"
    />
  </div>
</template>

<style scoped>
.two {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.cell-main {
  font-size: 13px;
}

.pending-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pending-list li {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--canvas);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.chip {
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--st-orange-bg);
  color: var(--st-orange);
  font-size: 11px;
}

@media (max-width: 1180px) {
  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

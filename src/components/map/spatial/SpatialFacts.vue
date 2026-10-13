<script setup lang="ts">
/**
 * 3D 选中对象的事实卡：只读。
 *
 * 数据不另接一套：楼栋/楼层/测点、最近**有效**读数、设备登记状态、未关闭事件
 * 全部来自助手的同一个只读快照（`buildSnapshot()` 与它的选择器），
 * 所以 2D、3D、小瞳三处对同一个 `pointId` 的说法必然一致。
 *
 * 三条口径不许省：人工检查点不给数值、没有有效读数不写"正常"、
 * 设备状态一律是人工登记字段（本机没有心跳，不能读成在线）。
 */
import { computed } from 'vue'
import { buildSnapshot, findPoint } from '@/assistant/selectors/snapshot'
import { factsOf, latestValidRecord, timingOf } from '@/assistant/selectors/records'
import { levelText, openEventsOfPoint } from '@/assistant/selectors/events'
import { deviceStatusText, NO_HEARTBEAT_NOTE } from '@/components/dashboard/text'
import type { PointMount } from '@/core/spatial/project'
import { formatDateTime } from '@/core/time'
import { hasNumericReadings, metricDef, qualityLabel, recordSourceLabel } from '@/types/catalog'
import AskXiaotongButton from '@/components/assistant/AskXiaotongButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const props = defineProps<{
  pointId: string
  /** 贴墙安装位置（来自空间投影）；null = 附近没有可取用的墙面 */
  mount?: PointMount | null
  /** 建议安装高度（世界单位） */
  mountHeight?: number | null
}>()
const emit = defineEmits<{ openTrend: [pointId: string]; openMedia: [pointId: string] }>()

const snapshot = computed(() => buildSnapshot())
const point = computed(() => findPoint(snapshot.value, props.pointId))
const device = computed(() => snapshot.value.devices.find((row) => row.pointId === props.pointId) ?? null)
const record = computed(() => latestValidRecord(snapshot.value.records, props.pointId))
const timing = computed(() => (record.value === null ? null : timingOf(record.value, snapshot.value.now)))
const facts = computed(() => {
  const row = record.value
  const current = point.value
  if (row === null || current === undefined) return []
  return factsOf(row.values, current.metric)
})
const openEvents = computed(() => openEventsOfPoint(snapshot.value.events, props.pointId))
const numeric = computed(() => (point.value === undefined ? false : hasNumericReadings(point.value.metric)))

const locationText = computed(() => {
  const row = point.value
  if (row === undefined) return ''
  return [row.buildingName, row.floorName, row.zoneId].filter((item) => item !== '').join(' · ')
})
</script>

<template>
  <div class="facts">
    <EmptyState v-if="point === undefined" title="未选中测点" sub="在上方模型里点测点标记，或用左侧列表选择" />
    <template v-else>
      <div class="head">
        <div>
          <b class="mono">{{ point.code }}</b>
          <div class="muted">{{ point.name }}</div>
        </div>
        <StatusTag :tone="point.dataSource === 'real' ? 'green' : 'gray'" :text="point.dataSource === 'real' ? '实测建档' : '示例数据'" :dot="false" />
      </div>
      <p class="muted">{{ locationText }}｜{{ numeric ? metricDef(point.metric).name : '人工检查点' }}</p>

      <template v-if="numeric">
        <div v-if="record !== null" class="reading">
          <div v-for="item in facts" :key="item.label" class="kv">
            <span class="muted">{{ item.label }}</span>
            <b class="num">{{ item.value }}<i>{{ item.unit }}</i></b>
          </div>
        </div>
        <p v-else class="notice notice--warn">
          该测点<strong>没有有效读数</strong>：不显示"正常"，也不给风险状态；请先补录有效数据。
        </p>
        <dl class="meta">
          <div><dt>采样时间</dt><dd class="num">{{ timing === null ? '—' : formatDateTime(timing.sampleTime) }}</dd></div>
          <div><dt>录入时间</dt><dd class="num">{{ timing === null ? '—' : formatDateTime(timing.enteredAt) }}</dd></div>
          <div><dt>读数新鲜度</dt><dd>{{ timing?.freshnessLabel ?? '—' }}</dd></div>
          <div><dt>来源 / 质量</dt><dd>{{ record === null ? '—' : `${recordSourceLabel(record, snapshot.now)}｜${qualityLabel(record.quality)}` }}</dd></div>
        </dl>
        <p v-if="record?.isBackfill === true" class="notice notice--warn">这是一条<strong>历史补录</strong>，不代表实时上报。</p>
      </template>
      <p v-else class="notice">人工检查点：只做现场检查与到点记录，<strong>没有传感器数值，也不显示数值</strong>。</p>

      <dl class="meta">
        <div><dt>安装位置</dt><dd>
          <span v-if="mount === null || mount === undefined">未贴合墙面（按平面坐标落位）</span>
          <span v-else>{{ mount.zoneLabel }}墙体定位点 · 示意离地约 {{ (mountHeight ?? 0).toFixed(2) }} m</span>
        </dd></div>
        <div><dt>设备型号</dt><dd>{{ device?.model || '未登记' }}</dd></div>
        <div><dt>档案位置</dt><dd>{{ device?.mountPosition || '未登记' }}</dd></div>
        <div><dt>测量方向</dt><dd>{{ device?.direction && device.direction !== '—' ? device.direction : '未登记' }}</dd></div>
        <div><dt>设备状态</dt><dd>{{ deviceStatusText(device?.health ?? 'none') }}</dd></div>
        <div><dt>未关闭事件</dt><dd>
          <span v-if="openEvents.length === 0">无</span>
          <span v-else>{{ openEvents.map((row) => `${row.eventNo}（${levelText(row.level)}）`).join('、') }}</span>
        </dd></div>
      </dl>
      <p v-if="mount !== null && mount !== undefined" class="muted">设备型号与位置取自档案；3D 芯体及模型高度仅为教学示意。固定工艺与实际埋深没有竣工依据，不能据此图判断施工方式。</p>
      <p class="muted">{{ NO_HEARTBEAT_NOTE }}</p>

      <div class="row wrap actions">
        <button type="button" class="act" @click="emit('openTrend', point.id)">看监测趋势</button>
        <button type="button" class="act" @click="emit('openMedia', point.id)">看影像对比</button>
        <AskXiaotongButton kind="point" :object-id="point.id" :label="`${point.code} ${point.name}`" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.facts { display: grid; gap: 8px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); }
.muted { color: var(--text-3); font-size: 11.5px; margin: 0; }
.reading { display: flex; flex-wrap: wrap; gap: 14px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--canvas); }
.kv { display: grid; gap: 2px; }
.kv b { font-size: 15px; }
.kv i { font-size: 11px; font-style: normal; color: var(--text-3); margin-left: 3px; }
.meta { display: grid; gap: 4px; margin: 0; font-size: 12px; }
.meta div { display: flex; justify-content: space-between; gap: 8px; }
.meta dt { color: var(--text-3); }
.meta dd { margin: 0; text-align: right; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.act {
  height: 26px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
  background: var(--paper); color: var(--text-2); font-size: 12px; cursor: pointer;
}
.act:hover { border-color: var(--brand-500); color: var(--brand-700); }
</style>

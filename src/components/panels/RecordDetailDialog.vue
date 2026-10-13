<script setup lang="ts">
/**
 * 监测记录详情：显示完整字段、本次读数与修订历史。
 * 修订保留原值，历史全程可追溯。
 */
import { computed } from 'vue'
import type { MetricValues, MonitorRecord } from '@/types/domain'
import { metricDef, pointTypeDef, qualityLabel, recordSourceLabel } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { fmtDelta, fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ open: boolean; record: MonitorRecord | undefined }>()
const emit = defineEmits<{ close: []; revise: [record: MonitorRecord] }>()

const archive = useArchiveStore()

function readText(values: MetricValues, metricKey: MonitorRecord['metric']): string {
  const def = metricDef(metricKey)
  return def.fields.map((field) => `${fmtNumber(values[field.key] ?? null, field.digits)}${field.unit}`).join(' / ')
}

function deltaText(record: MonitorRecord): string {
  const list = metricDef(record.metric).deltas(record.values, record.baselineValues)
  if (list.length === 0) return '—'
  return list.map((item) => `${fmtDelta(item.value, item.digits)}${item.unit}`).join(' ')
}

function pointName(pointId: string): string {
  const point = archive.pointById(pointId)
  return point === undefined ? '未知测点' : `${point.code} ${point.name}`
}

const items = computed(() => {
  const record = props.record
  if (record === undefined) return []
  const point = archive.pointById(record.pointId)
  return [
    { label: '记录编号', value: record.recordNo, mono: true },
    { label: '测点', value: pointName(record.pointId) },
    { label: '指标类型', value: point === undefined ? '—' : pointTypeDef(point.type).name },
    { label: '采样时间', value: formatDateTime(record.sampleTime), mono: true },
    { label: '录入时间', value: formatDateTime(record.enteredAt), mono: true },
    { label: '录入人', value: `${record.enteredBy} · ${record.enteredByRole}` },
    { label: '数据来源', value: recordSourceLabel(record, new Date().toISOString()) },
    { label: '质量标记', value: qualityLabel(record.quality) },
    { label: '数据标记', value: record.isBackfill ? '历史补录' : '常规录入' },
    { label: '单位', value: record.unit, mono: true },
    { label: '统计窗口', value: record.sampleWindow === '' ? '—' : record.sampleWindow, mono: true },
    { label: '采集设备', value: archive.deviceById(record.deviceId ?? '')?.code ?? '未指定' },
    {
      label: '基准快照',
      value:
        record.baselineVersion === null
          ? '该指标不设相对基准'
          : `v${record.baselineVersion}｜${readText(record.baselineValues ?? {}, record.metric)}`,
    },
    { label: '备注', value: record.note === '' ? '—' : record.note, wide: true },
  ]
})
</script>

<template>
  <AppModal
    :open="open && record !== undefined"
    :title="record === undefined ? '' : `记录详情 · ${record.recordNo}`"
    sub="修订保留原值，历史全程可追溯"
    :width="720"
    @close="emit('close')"
  >
    <template v-if="record !== undefined">
      <dl class="kv">
        <div v-for="item in items" :key="item.label" class="kv-item">
          <dt>{{ item.label }}</dt>
          <dd :class="{ num: item.mono }">{{ item.value }}</dd>
        </div>
      </dl>

      <div class="block">
        <div class="block-title">本次读数</div>
        <div class="reading">
          <span class="num reading-value">{{ readText(record.values, record.metric) }}</span>
          <span class="muted">变化量 {{ deltaText(record) }}</span>
        </div>
      </div>

      <div class="block">
        <div class="block-title">修订历史（{{ record.revisions.length }} 次）</div>
        <p v-if="record.revisions.length === 0" class="muted">该记录未修订过，原始值即为当前值。</p>
        <ul v-else class="rev-list">
          <li v-for="(revision, index) in record.revisions" :key="index">
            <div class="row-between">
              <span class="code">第 {{ index + 1 }} 次 · {{ formatDateTime(revision.at) }}</span>
              <span class="muted">{{ revision.by }} · {{ revision.role }}</span>
            </div>
            <div class="rev-body">
              <span class="muted">修订前：</span>
              <span class="num">{{ readText(revision.before.values, record.metric) }}</span>
              <span class="muted">｜采样时间 {{ formatDateTime(revision.before.sampleTime) }}</span>
              <span class="muted">｜质量 {{ qualityLabel(revision.before.quality) }}</span>
            </div>
            <div class="rev-reason">原因：{{ revision.reason }}</div>
          </li>
        </ul>
      </div>
    </template>

    <template #footer>
      <AppButton @click="emit('close')">关闭</AppButton>
      <AppButton v-if="record !== undefined" variant="primary" @click="emit('revise', record)">修订该记录</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
}

.kv dt {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 2px;
}

.kv dd {
  margin: 0;
  font-size: 13.5px;
}

.block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.reading {
  display: flex;
  align-items: baseline;
  gap: 16px;
}

.reading-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--brand-700);
}

.rev-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rev-list li {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--canvas);
  font-size: 12.5px;
}

.rev-body {
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rev-reason {
  margin-top: 4px;
  color: var(--text-2);
}
</style>

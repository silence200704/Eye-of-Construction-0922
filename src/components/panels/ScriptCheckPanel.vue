<script setup lang="ts">
/**
 * 演示数据脚本核对：把项目组提供的三段演示数据按当前规则实算，
 * 并列显示"标准预期结果"与"实算数据状态"，并给出对应的允许操作。
 */
import { computed } from 'vue'
import type { MetricValues, MonitorRecord } from '@/types/domain'
import type { RuleMetric } from '@/types/rules'
import { metricDef } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { previewRecord, stateAllowedAction, stateLabel, stateTone } from '@/core/rules'
import { assessPoint } from '@/stores/assessment'
import { fmtDelta, fmtNumber } from '@/core/format'
import { fromLocalInput } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const archive = useArchiveStore()

interface ScriptRow {
  label: string
  sampleTime: string
  values: MetricValues
  expect: string
}

interface ScriptSpec {
  metric: RuleMetric
  title: string
  baselineValues: MetricValues | null
  rows: ScriptRow[]
}

/** 数值取自项目组提供的演示数据，预期结果按规则引擎实算，便于核对是否一致。 */
const SCRIPTS: ScriptSpec[] = [
  {
    metric: 'crack_width',
    title: '裂缝宽度变化（基准 0.50 mm）',
    baselineValues: { width: 0.5 },
    rows: [
      { label: '第一天 09:00', sampleTime: '2026-09-15T09:00', values: { width: 0.52 }, expect: '正常' },
      { label: '第二天 09:00', sampleTime: '2026-09-16T09:00', values: { width: 0.62 }, expect: '黄色预警' },
      { label: '第三天 09:00', sampleTime: '2026-09-17T09:00', values: { width: 0.73 }, expect: '橙色预警' },
      { label: '第四天 09:00', sampleTime: '2026-09-18T09:00', values: { width: 0.82 }, expect: '红色预警' },
      { label: '维修后第 1 条', sampleTime: '2026-09-25T09:00', values: { width: 0.54 }, expect: '恢复待确认' },
      { label: '维修后第 2 条', sampleTime: '2026-09-25T09:05', values: { width: 0.53 }, expect: '（标准表未列）' },
      { label: '维修后第 3 条', sampleTime: '2026-09-25T09:10', values: { width: 0.53 }, expect: '恢复待确认' },
      { label: '复查记录', sampleTime: '2026-09-26T09:00', values: { width: 0.53 }, expect: '可以申请关闭' },
    ],
  },
  {
    metric: 'tilt_xy',
    title: '倾角变化（基准 X 0.00° / Y 0.00°）',
    baselineValues: { angleX: 0, angleY: 0 },
    rows: [
      { label: '第 1 条', sampleTime: '2026-09-15T09:00', values: { angleX: 0.04, angleY: -0.02 }, expect: '正常' },
      { label: '第 2 条', sampleTime: '2026-09-16T09:00', values: { angleX: 0.12, angleY: -0.04 }, expect: '黄色' },
      { label: '第 3 条', sampleTime: '2026-09-17T09:00', values: { angleX: 0.22, angleY: -0.08 }, expect: '橙色' },
      { label: '第 4 条', sampleTime: '2026-09-18T09:00', values: { angleX: 0.34, angleY: -0.12 }, expect: '红色' },
    ],
  },
  {
    metric: 'vibration',
    title: '楼板振动（1 秒窗口 RMS，绝对判定）',
    baselineValues: null,
    rows: [
      { label: '第 1 条', sampleTime: '2026-09-15T15:00', values: { accelRms: 0.04, accelPeak: 0.12 }, expect: '正常' },
      { label: '第 2 条', sampleTime: '2026-09-16T15:00', values: { accelRms: 0.06, accelPeak: 0.18 }, expect: '黄色' },
      { label: '第 3 条', sampleTime: '2026-09-17T15:00', values: { accelRms: 0.12, accelPeak: 0.32 }, expect: '橙色' },
      { label: '第 4 条', sampleTime: '2026-09-18T15:00', values: { accelRms: 0.22, accelPeak: 0.55 }, expect: '红色' },
    ],
  },
]

function scriptPoint(metric: RuleMetric, archive: ReturnType<typeof useArchiveStore>): string {
  const point = archive.activePoints.find((row) => archive.ruleFor(row.id, new Date().toISOString())?.metric === metric)
  return point?.id ?? ''
}

function runScript(spec: ScriptSpec, archive: ReturnType<typeof useArchiveStore>) {
  const pointId = scriptPoint(spec.metric, archive)
  const point = archive.pointById(pointId)
  if (point === undefined) return []
  // 按顺序累加，前几条作为后续判定的历史，持续异常与恢复待确认才成立
  const accumulated: MonitorRecord[] = []
  return spec.rows.map((row) => {
    const at = fromLocalInput(row.sampleTime)
    const outcome = assessPoint({
      pointId: point.id,
      values: row.values,
      sampleTime: at,
      sampleWindow: point.metric === 'vibration' ? '1 s' : '',
      quality: 'valid',
      deviceId: null,
      extraHistory: [...accumulated],
      sequenceOnly: true,
    })
    accumulated.push(
      previewRecord({
        pointId: point.id,
        metric: point.metric,
        values: row.values,
        baselineValues: outcome?.baseline?.values ?? null,
        unit: outcome?.rule.unit ?? '',
        sampleTime: at,
        sampleWindow: point.metric === 'vibration' ? '1 s' : '',
      }),
    )
    if (outcome === null) {
      return { row, actual: '无适用规则', tone: 'gray' as const, trigger: '—', action: '—', note: '' }
    }
    const { assessment } = outcome
    return {
      row,
      actual: stateLabel(assessment.state),
      tone: stateTone(assessment.state),
      trigger: assessment.triggerValue === null ? '—' : `${fmtNumber(assessment.triggerValue, 2)} ${outcome.rule.unit}`,
      action: stateAllowedAction(assessment.state),
      note: assessment.insufficientReason,
    }
  })
}

const scriptTables = computed(() => SCRIPTS.map((spec) => ({ spec, rows: runScript(spec, archive) })))

function valueText(spec: ScriptSpec, row: ScriptRow): string {
  const def = metricDef(spec.metric === 'environment' ? 'temp_humidity' : spec.metric)
  return def.fields
    .map((field) => `${fmtNumber(row.values[field.key] ?? null, field.digits)}${field.unit}`)
    .join(' / ')
}

function deltaText(spec: ScriptSpec, row: ScriptRow): string {
  if (spec.baselineValues === null) return '—'
  const def = metricDef(spec.metric === 'environment' ? 'temp_humidity' : spec.metric)
  const list = def.deltas(row.values, spec.baselineValues)
  if (list.length === 0) return '—'
  return list.map((item) => `${fmtDelta(item.value, item.digits)}${item.unit}`).join(' ')
}
</script>

<template>
      <SectionCard
        title="演示数据脚本核对"
        sub="数值取自项目组提供的演示数据；右两列为按当前规则实算的结果，用于核对标准与实现是否一致"
      >
        <p class="notice notice--warn">
          <b>两列的关系：</b>「标准预期结果」取自项目组提供的演示数据脚本，「实算数据状态」是按当前规则跑出来的真实结果。
          规则要求「连续 3 条有效记录低于黄色阈值的 80%」才成立，因此维修后单独一条 0.54 mm 尚未满足恢复条件 ——
          标准表只列了一条维修后记录，本表按规则补齐到第 3 条，恢复过程才可达；<b>右侧一列才是系统实际判定</b>。
          「允许操作」是数据状态对应的下一步，与数据状态本身不是同一个维度。
        </p>
        <div v-for="table in scriptTables" :key="table.spec.metric" class="script-block">
          <div class="script-title">{{ table.spec.title }}</div>
          <DataTable
            :columns="[
              { key: 'label', label: '阶段', width: '122px' },
              { key: 'value', label: '读数', width: '150px' },
              { key: 'delta', label: '相对基准变化', width: '138px' },
              { key: 'expect', label: '标准预期结果', width: '122px' },
              { key: 'actual', label: '实算数据状态', width: '148px' },
              { key: 'action', label: '允许操作' },
            ]"
            :row-count="table.rows.length"
            empty="没有可试算的测点（请确认规则适用范围与该测点匹配）"
          >
            <tr v-for="item in table.rows" :key="item.row.label">
              <td>
                <div>{{ item.row.label }}</div>
                <div class="code">{{ item.row.sampleTime.replace('T', ' ') }}</div>
              </td>
              <td class="num">{{ valueText(table.spec, item.row) }}</td>
              <td class="num">{{ deltaText(table.spec, item.row) }}</td>
              <td>{{ item.row.expect }}</td>
              <td>
                <StatusTag :tone="item.tone" :text="item.actual" />
                <div v-if="item.trigger !== '—'" class="code">触发值 {{ item.trigger }}</div>
              </td>
              <td class="muted">
                <div>{{ item.action }}</div>
                <div v-if="item.note !== ''" class="code">{{ item.note }}</div>
              </td>
            </tr>
          </DataTable>
        </div>
      </SectionCard>
</template>

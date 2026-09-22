<script setup lang="ts">
/**
 * 单条监测录入与修订。
 * 校验：必填、数值类型、单位、重复时间、时间有效性；缺项不默认为零；
 * 修订保存原值，不静默覆盖。
 */
import { computed, watch } from 'vue'
import type { MetricKey, MetricValues, MonitorRecord, Point, QualityFlag, RecordSource } from '@/types/domain'
import { BACKFILL_THRESHOLD_MINUTES, QUALITY_OPTIONS, SOURCE_LABELS, SOURCE_OPTIONS, hasNumericReadings, metricDef } from '@/types/catalog'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { assessPoint } from '@/stores/assessment'
import { parseNum } from '@/core/format'
import { useFormModel } from '@/core/useForm'
import { formatDateTime, fromLocalInput, isBackfill, nowIso, toLocalInput } from '@/core/time'
import { checkReading, outOfDeviceRange } from '@/core/validate'
import type { FieldDef } from '@/types/forms'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import LevelPreviewBox from '@/components/panels/LevelPreviewBox.vue'

const props = defineProps<{ open: boolean; pointId: string | null; record: MonitorRecord | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const archive = useArchiveStore()
const records = useRecordsStore()

const pointOptions = computed(() =>
  archive.activePoints.map((row) => ({ value: row.id, label: `${row.code} ${row.name}` })),
)

const targetPoint = computed<Point | undefined>(() => archive.pointById(String(model.value.pointId ?? '')))
const metric = computed<MetricKey>(() => targetPoint.value?.metric ?? 'crack_width')
const def = computed(() => metricDef(metric.value))
/**
 * 按采样时间取生效基准 —— 与正式判定同一口径。
 * 补录历史数据时，预览与事件判定必须看到同一个基准，否则会出现"预览按当前基准、落库按历史基准"。
 */
const baseline = computed(() => {
  const point = targetPoint.value
  if (point === undefined) return undefined
  const at = fromLocalInput(String(model.value.sampleTime ?? '')) || nowIso()
  return archive.baselineAt(point.id, at)
})

/** 读数字段：按指标定义生成；有基准时把基准版本写进提示，与判定口径保持一致。 */
function readingFields(): FieldDef[] {
  const list: FieldDef[] = []
  if (props.pointId === null) {
    list.push({ key: 'pointId', label: '测点', type: 'select', required: true, options: pointOptions.value })
  }
  for (const field of def.value.fields) {
    list.push({
      key: field.key,
      label: field.label,
      type: 'number',
      required: true,
      unit: field.unit,
      step: field.step,
      placeholder: field.placeholder,
      hint: baseline.value === undefined ? '该测点尚未设置基准，本次记录只保存读数' : `录入时基准快照将保存为 v${baseline.value.version}`,
    })
  }
  return list
}

/** 元数据字段：单位、采样时间、窗口、设备、来源、质量、备注与修订原因。 */
function metaFields(): FieldDef[] {
  return [
    {
      key: 'unit',
      label: '单位',
      type: 'select',
      required: true,
      options: def.value.unitOptions.map((unit) => ({ value: unit, label: unit })),
    },
    {
      key: 'sampleTime',
      label: '采样时间',
      type: 'datetime',
      required: true,
      hint: '允许合理的历史补录，但不得晚于当前时间',
    },
    {
      key: 'sampleWindow',
      label: '统计窗口',
      type: 'text',
      required: true,
      visible: () => metric.value === 'vibration',
      placeholder: '例如 1 s',
      hint: '振动必须统一单位和统计窗口，未提供原始采样不生成真实波形',
    },
    {
      key: 'deviceId',
      label: '采集设备',
      type: 'select',
      options: () => deviceOptions.value,
      hint: '人工录入可留空；选择设备表示该读数来自该设备通道',
    },
    {
      key: 'source',
      label: '数据来源',
      type: 'select',
      required: true,
      /*
       * 修订导入产生的记录时，来源固定是 CSV 批量导入：它不在手工可选的列表里，
       * 但要能显示出来，否则下拉会是一片空白；也不允许把手工录入改成导入。
       */
      options: props.record?.source === 'csv' ? [SOURCE_LABELS[SOURCE_LABELS.length - 1]] : SOURCE_OPTIONS,
      hint: props.record?.source === 'csv' ? '该记录由 CSV 批量导入产生，来源不可改' : '',
    },
    { key: 'quality', label: '质量标记', type: 'select', required: true, options: QUALITY_OPTIONS },
    {
      key: 'qualityNote',
      label: '质量说明',
      type: 'text',
      required: true,
      span: 2,
      visible: (m) => m.quality !== 'valid',
      placeholder: '例如 现场遮挡导致读数跳变，需复测确认',
    },
    { key: 'note', label: '备注', type: 'textarea', span: 2, rows: 2 },
    {
      key: 'reason',
      label: '修订原因',
      type: 'textarea',
      span: 2,
      rows: 2,
      required: true,
      visible: () => props.record !== null,
      placeholder: '例如 原记录采样时间填写有误，按现场记录更正',
    },
  ]
}

const fields = computed<FieldDef[]>(() =>
  hasNumericReadings(metric.value) ? [...readingFields(), ...metaFields()] : [],
)

const deviceOptions = computed(() => {
  const target = targetPoint.value
  if (target === undefined) return []
  return archive.devicesOfPoint(target.id).map((row) => ({ value: row.id, label: `${row.code} ${row.name}` }))
})

const { model, errors, submitError, reset, mergeIssues, run } = useFormModel(() => fields.value)

/** 人工检查点不产生数值记录，无法录入。 */
const numeric = computed(() => hasNumericReadings(metric.value))

const selectedDevice = computed(() => archive.deviceById(String(model.value.deviceId ?? '')))

/** 录入过程中的变化量预览：属于数据展示，不在此处做等级判定（判定在 V0.2）。 */
const deltas = computed(() => def.value.deltas(readValues(), baseline.value?.values ?? null))

/** 实时提示：超量程按方案标记无效并进入数据核查，不阻止提交。 */
const rangeHint = computed(() => {
  if (!numeric.value || !outOfDeviceRange(readValues(), selectedDevice.value)) return ''
  return `读数超出设备量程 ${selectedDevice.value?.rangeText ?? ''}，保存后将标记为无效并进入数据核查，请填写质量说明`
})

/**
 * 实时分级：按采样时间取生效基准与规则版本后判定，保存前就能看到是未越限还是黄橙红。
 * 与保存后的正式判定共用 assessPoint，避免页面与落库结果不一致。
 */
/** 采样时间的可读文本，用于说明基准按哪个时刻选取。 */
const sampledAtText = computed(() => {
  const raw = fromLocalInput(String(model.value.sampleTime ?? ''))
  return raw === '' ? '所选时间无法解析' : formatDateTime(raw)
})

const liveAssessment = computed(() => {
  const point = targetPoint.value
  if (point === undefined || !numeric.value) return null
  const at = fromLocalInput(String(model.value.sampleTime ?? '')) || nowIso()
  const outcome = assessPoint({
    pointId: point.id,
    values: readValues(),
    sampleTime: at,
    sampleWindow: String(model.value.sampleWindow ?? ''),
    quality: String(model.value.quality ?? 'valid') as QualityFlag,
    deviceId: String(model.value.deviceId ?? '') === '' ? null : String(model.value.deviceId),
    excludeRecordId: props.record?.id ?? null,
  })
  if (outcome === null) return { missing: true as const }
  return { missing: false as const, rule: outcome.rule, baseline: outcome.baseline, result: outcome.assessment }
})

/** 实时提示：采样时间明显早于当前时间即为历史补录，不得伪装成实时预警。 */
const backfillHint = computed(() => {
  if (!numeric.value) return ''
  const sample = fromLocalInput(String(model.value.sampleTime ?? ''))
  if (sample === '') return ''
  return isBackfill(sample, nowIso(), BACKFILL_THRESHOLD_MINUTES)
    ? '采样时间明显早于当前时间，将标记为历史补录，必须填写补录说明'
    : ''
})

function readValues(): MetricValues {
  const values: MetricValues = {}
  for (const field of def.value.fields) {
    const value = parseNum(String(model.value[field.key] ?? ''))
    if (value !== null) values[field.key] = value
  }
  return values
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const target = props.record
    if (target !== null) {
      const base: Record<string, unknown> = {
        pointId: target.pointId,
        unit: target.unit,
        sampleTime: toLocalInput(target.sampleTime),
        sampleWindow: target.sampleWindow,
        deviceId: target.deviceId ?? '',
        source: target.source,
        quality: target.quality,
        qualityNote: target.qualityNote,
        note: target.note,
        reason: '',
      }
      for (const field of metricDef(target.metric).fields) {
        const value = target.values[field.key]
        base[field.key] = value === undefined ? '' : value
      }
      reset(base)
      return
    }
    const point = archive.pointById(props.pointId ?? '')
    const unit = point === undefined ? '' : metricDef(point.metric).unitOptions[0]
    const base: Record<string, unknown> = {
      pointId: props.pointId ?? '',
      unit,
      sampleTime: toLocalInput(nowIso()),
      sampleWindow: point?.metric === 'vibration' ? '1 s' : '',
      deviceId: '',
      source: 'manual',
      quality: 'valid',
      qualityNote: '',
      note: '',
      reason: '',
    }
    for (const field of metricDef(point?.metric ?? 'crack_width').fields) base[field.key] = ''
    reset(base)
    if (point !== undefined) {
      const owned = archive.devicesOfPoint(point.id)
      if (owned.length > 0) model.value.deviceId = owned[0].id
    }
  },
)

watch(
  () => model.value.pointId,
  () => {
    const point = targetPoint.value
    if (point === undefined) return
    const units = metricDef(point.metric).unitOptions
    if (!units.includes(String(model.value.unit ?? ''))) model.value.unit = units[0]
    if (point.metric === 'vibration' && String(model.value.sampleWindow ?? '') === '') {
      model.value.sampleWindow = '1 s'
    }
  },
)

async function submit(): Promise<void> {
  const point = targetPoint.value
  if (point === undefined) {
    mergeIssues([{ field: 'pointId', message: '请先选择测点' }])
    return
  }
  if (!numeric.value) {
    mergeIssues([{ field: 'pointId', message: '人工检查点不产生数值记录，无需录入监测数据' }])
    return
  }
  const enteredAt = nowIso()
  const sampleTime = fromLocalInput(String(model.value.sampleTime ?? ''))
  const check = checkReading(
    {
      pointId: point.id,
      metric: point.metric,
      values: readValues(),
      unit: String(model.value.unit ?? ''),
      sampleTime,
      sampleWindow: String(model.value.sampleWindow ?? ''),
      quality: String(model.value.quality ?? 'valid') as QualityFlag,
      qualityNote: String(model.value.qualityNote ?? ''),
      note: String(model.value.note ?? '').trim(),
      excludeRecordId: props.record?.id ?? null,
      device: selectedDevice.value,
      enteredAt,
    },
    records.records,
  )
  if (!mergeIssues(check.issues)) return

  const draft = {
    pointId: point.id,
    deviceId: String(model.value.deviceId ?? '') === '' ? null : String(model.value.deviceId),
    values: readValues(),
    unit: String(model.value.unit ?? ''),
    sampleTime,
    sampleWindow: String(model.value.sampleWindow ?? '').trim(),
    source: String(model.value.source ?? 'manual') as RecordSource,
    // 超量程按方案标记为无效并进入数据核查，不阻止提交
    quality: check.outOfRange ? ('invalid' as QualityFlag) : (String(model.value.quality ?? 'valid') as QualityFlag),
    qualityNote: String(model.value.qualityNote ?? '').trim(),
    note: String(model.value.note ?? '').trim(),
  }

  const ok = await run(async () => {
    if (props.record === null) {
      await records.addRecord(draft)
    } else {
      await records.reviseRecord(props.record.id, draft, String(model.value.reason ?? '').trim())
    }
  })
  if (ok) {
    emit('saved')
    emit('close')
  }
}
</script>

<template>
  <AppModal
    :open="open"
    :title="record === null ? '录入监测数据' : `修订记录 · ${record.recordNo}`"
    :sub="
      record === null
        ? '单条录入；采样时间与录入时间分别保存，修改保留原值'
        : '修订会把修订前的数值、单位、采样时间与质量标记完整保留在记录中'
    "
    :width="760"
    @close="emit('close')"
  >
    <p v-if="!numeric" class="notice notice--brand">
      该点位是人工检查点，不产生数值记录：本页不提供录入。人工检查的清单填写、照片上报与必查点覆盖在后续版本提供，
      当前版本可维护它的档案、位置与检查范围。
    </p>
    <FormGrid v-else v-model="model" :fields="fields" :errors="errors" />

    <div v-if="deltas.length > 0" class="delta-box">
      <div class="delta-title">相对基准变化量（预览）</div>
      <div class="delta-row">
        <div v-for="item in deltas" :key="item.label" class="delta-item">
          <span class="muted">{{ item.label }}</span>
          <span class="num delta-value">{{ item.value === null ? '—' : (item.value > 0 ? '+' : '') + item.value.toFixed(item.digits) }}</span>
          <span class="field-unit">{{ item.unit }}</span>
        </div>
      </div>
      <p class="field-hint">此处仅显示相对基准的变化量，预警分级与事件去重由 V0.2 的规则判定完成。</p>
    </div>
    <p v-else-if="def.baselineFields.length === 0" class="field-hint after">
      该指标不设相对基准：振动以固定统计窗口的有效值绝对判定，温湿度为环境辅助数据，因此不计算变化量。
    </p>

    <LevelPreviewBox
      v-if="liveAssessment !== null && !liveAssessment.missing"
      :rule="liveAssessment.rule!"
      :baseline="liveAssessment.baseline"
      :result="liveAssessment.result"
      :sampled-at-text="sampledAtText"
    />
    <p v-else-if="liveAssessment !== null && liveAssessment.missing" class="field-hint after">
      该测点没有适用的启用规则，本次录入不做分级。
    </p>

    <p v-if="rangeHint !== ''" class="notice notice--warn after">{{ rangeHint }}</p>
    <p v-else-if="backfillHint !== ''" class="notice notice--warn after">{{ backfillHint }}</p>

    <p v-if="records.lastEventMessage !== ''" class="notice notice--brand after">预警事件：{{ records.lastEventMessage }}</p>

    <p v-if="submitError !== ''" class="notice notice--warn after">保存失败：{{ submitError }}</p>

    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton variant="primary" @click="submit">
        {{ record === null ? '保存记录' : '保存修订' }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.delta-box {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--brand-200);
  border-radius: var(--r-sm);
  background: var(--brand-050);
}

.delta-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand-700);
  margin-bottom: 8px;
}

.delta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}

.delta-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
}

.delta-value {
  font-size: 17px;
  font-weight: 600;
  color: var(--brand-700);
}

.after {
  margin-top: 14px;
}

</style>

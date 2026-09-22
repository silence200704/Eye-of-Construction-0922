<script setup lang="ts">
/**
 * 基准值设置：改变基准必须记录版本与原因，历史版本不覆盖。
 * 振动与温湿度按方案不设相对基准，此处明确提示而不是留空保存。
 */
import { computed, watch } from 'vue'
import type { MetricValues, Point } from '@/types/domain'
import { baselineFields } from '@/config/fields/baselineFields'
import { saveBaseline, type BaselineDraft } from '@/stores/writes/archiveWrites'
import { useArchiveStore } from '@/stores/archive'
import { metricDef } from '@/types/catalog'
import { parseNum } from '@/core/format'
import { useFormModel } from '@/core/useForm'
import { fromLocalInput, nowIso, toLocalInput } from '@/core/time'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const props = defineProps<{ open: boolean; point: Point | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const archive = useArchiveStore()
const current = computed(() => (props.point === null ? undefined : archive.currentBaseline(props.point.id)))
const metric = computed(() => props.point?.metric ?? 'crack_width')
const def = computed(() => metricDef(metric.value))
const supported = computed(() => def.value.baselineFields.length > 0)

const fields = computed(() => (props.point === null ? [] : baselineFields(metric.value, current.value)))
const { model, errors, submitError, reset, mergeIssues, run } = useFormModel(() => fields.value)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const base: Record<string, unknown> = {
      effectiveFrom: toLocalInput(nowIso()),
      reason: '',
    }
    for (const field of def.value.baselineFields) {
      const value = current.value?.values[field.key]
      base[field.key] = value === undefined ? '' : value
    }
    reset(base)
  },
)

function buildValues(): MetricValues {
  const values: MetricValues = {}
  for (const field of def.value.baselineFields) {
    const value = parseNum(String(model.value[field.key] ?? ''))
    if (value !== null) values[field.key] = value
  }
  return values
}

async function submit(): Promise<void> {
  if (props.point === null || !supported.value) return
  if (!mergeIssues([])) return
  const draft: BaselineDraft = {
    pointId: props.point.id,
    values: buildValues(),
    unit: def.value.unit,
    reason: String(model.value.reason ?? '').trim(),
    effectiveFrom: fromLocalInput(String(model.value.effectiveFrom ?? '')) || nowIso(),
  }
  const ok = await run(async () => {
    await saveBaseline(draft)
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
    title="设置基准值"
    :sub="point === null ? '' : `${point.code} ${point.name}｜指标：${def.name}`"
    :width="640"
    @close="emit('close')"
  >
    <template v-if="point !== null">
      <div class="row-between head">
        <div class="row">
          <span class="muted">当前生效版本</span>
          <StatusTag v-if="current !== undefined" tone="brand" :text="`v${current.version}`" :dot="false" />
          <StatusTag v-else tone="gray" text="尚未设置" />
        </div>
        <span v-if="current !== undefined" class="muted">生效于 {{ current.effectiveFrom.slice(0, 10) }}</span>
      </div>

      <p class="notice notice--brand">{{ def.baselineNote }}</p>

      <div v-if="supported" class="form-holder">
        <FormGrid v-model="model" :fields="fields" :errors="errors" />
      </div>
      <p v-else class="notice notice--warn">
        本指标按方案不设置相对基准：振动以固定统计窗口的有效值绝对判定，温湿度为环境辅助数据，两者都不能凭相对变化生成结构结论。
      </p>
      <p v-if="submitError !== ''" class="notice notice--warn submit-error">保存失败：{{ submitError }}</p>
    </template>

    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton v-if="supported" variant="primary" @click="submit">
        {{ current === undefined ? '设置基准' : `保存为 v${current.version + 1}` }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.head {
  margin-bottom: 12px;
  font-size: 12.5px;
}

.form-holder {
  margin-top: 14px;
}
</style>

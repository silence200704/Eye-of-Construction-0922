<script setup lang="ts">
/**
 * 预警规则编辑。
 * 修改阈值会写入操作日志并记录版本变化；历史数据仍按当时的规则版本解释，不做覆盖。
 */
import { computed, watch } from 'vue'
import type { MonitoringRule } from '@/types/rules'
import { saveRule, type RuleDraft } from '@/stores/writes/ruleWrites'
import { parseNum } from '@/core/format'
import { useFormModel } from '@/core/useForm'
import type { FieldDef } from '@/types/forms'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormGrid from '@/components/ui/FormGrid.vue'

const props = defineProps<{ open: boolean; rule: MonitoringRule | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const isEnvironment = computed(() => props.rule?.environment !== null && props.rule?.environment !== undefined)

const fields = computed<FieldDef[]>(() => {
  const list: FieldDef[] = [
    { key: 'name', label: '规则名称', type: 'text', required: true, span: 2 },
    { key: 'code', label: '规则编号', type: 'text', required: true },
    {
      key: 'version',
      label: '当前版本',
      type: 'readonly',
      hint: '保存后自动生成新版本（如 V1.0 → V1.1），旧版本原样保留；版本号由系统维护，避免覆盖既有版本',
    },
    { key: 'unit', label: '单位', type: 'text', required: true },
    {
      key: 'enabled',
      label: '规则状态',
      type: 'select',
      required: true,
      options: [
        { value: 'true', label: '已启用' },
        { value: 'false', label: '已停用' },
      ],
    },
  ]

  if (isEnvironment.value) {
    list.push(
      { key: 'tempMin', label: '温度下限', type: 'number', step: 0.1, unit: '℃', hint: '低于该值生成环境提醒' },
      { key: 'tempMax', label: '温度上限', type: 'number', step: 0.1, unit: '℃' },
      { key: 'humidityMax', label: '相对湿度上限', type: 'number', step: 0.1, unit: '%RH' },
    )
  } else {
    list.push(
      { key: 'yellow', label: '黄色关注阈值', type: 'number', step: 0.01, required: true, hint: '判定值 ≥ 该值即为黄色关注' },
      { key: 'orange', label: '橙色排查阈值', type: 'number', step: 0.01, required: true },
      { key: 'red', label: '红色紧急核查阈值', type: 'number', step: 0.01, required: true, hint: '必须满足 黄色 ≤ 橙色 ≤ 红色' },
      {
        key: 'rateThreshold',
        label: '变化速率阈值',
        type: 'number',
        step: 0.01,
        hint: '留空表示未配置、当前不判速率。未配置时页面显示"待专业人员确认"，不填入推测数值',
      },
    )
  }

  list.push(
    { key: 'persistenceMinRecords', label: '持续条件·最少记录数', type: 'number', step: 1, required: true, unit: '条' },
    { key: 'persistenceMinSpanMinutes', label: '持续条件·最小跨度', type: 'number', step: 1, required: true, unit: '分钟' },
    { key: 'persistenceMaxGapMinutes', label: '持续条件·最大相邻间隔', type: 'number', step: 1, required: true, unit: '分钟' },
    { key: 'recoveryRatio', label: '恢复阈值比例', type: 'number', step: 0.05, required: true, hint: '恢复阈值 = 黄色阈值 × 该比例，默认 0.8' },
    { key: 'recoveryMinRecords', label: '恢复条件·连续条数', type: 'number', step: 1, required: true, unit: '条' },
    { key: 'confirmedBy', label: '确认人', type: 'text' },
    { key: 'note', label: '规则说明', type: 'textarea', span: 2, rows: 3 },
  )
  return list
})

const { model, errors, submitError, pending, reset, mergeIssues, run } = useFormModel(() => fields.value)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const rule = props.rule
    if (rule === null) {
      reset({})
      return
    }
    reset({
      name: rule.name,
      code: rule.code,
      version: rule.version,
      unit: rule.unit,
      enabled: String(rule.enabled),
      yellow: rule.thresholds?.yellow ?? '',
      orange: rule.thresholds?.orange ?? '',
      red: rule.thresholds?.red ?? '',
      rateThreshold: rule.rateThreshold ?? '',
      persistenceMinRecords: rule.persistence.minRecords,
      persistenceMinSpanMinutes: rule.persistence.minSpanMinutes,
      persistenceMaxGapMinutes: rule.persistence.maxGapMinutes,
      recoveryRatio: rule.recovery.yellowRatio,
      recoveryMinRecords: rule.recovery.minRecords,
      tempMin: rule.environment?.tempMin ?? '',
      tempMax: rule.environment?.tempMax ?? '',
      humidityMax: rule.environment?.humidityMax ?? '',
      confirmedBy: rule.confirmedBy,
      note: rule.note,
    })
  },
)

function buildDraft(): RuleDraft {
  const num = (key: string): number | null => parseNum(String(model.value[key] ?? ''))
  return {
    code: String(model.value.code ?? '').trim(),
    name: String(model.value.name ?? '').trim(),
    version: String(model.value.version ?? '').trim(),
    enabled: String(model.value.enabled) === 'true',
    unit: String(model.value.unit ?? '').trim(),
    yellow: num('yellow'),
    orange: num('orange'),
    red: num('red'),
    rateThreshold: num('rateThreshold'),
    persistenceMinRecords: num('persistenceMinRecords') ?? 3,
    persistenceMinSpanMinutes: num('persistenceMinSpanMinutes') ?? 10,
    persistenceMaxGapMinutes: num('persistenceMaxGapMinutes') ?? 5,
    recoveryRatio: num('recoveryRatio') ?? 0.8,
    recoveryMinRecords: num('recoveryMinRecords') ?? 3,
    tempMin: num('tempMin'),
    tempMax: num('tempMax'),
    humidityMax: num('humidityMax'),
    confirmedBy: String(model.value.confirmedBy ?? '').trim(),
    note: String(model.value.note ?? '').trim(),
  }
}

async function submit(): Promise<void> {
  if (props.rule === null) return
  if (!mergeIssues([])) return
  const ok = await run(async () => {
    await saveRule(props.rule!.id, buildDraft())
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
    :title="rule === null ? '编辑预警规则' : `编辑规则 · ${rule.code}`"
    sub="调整阈值只影响后续数据；历史记录仍按采样当时生效的规则版本解释"
    :width="780"
    @close="emit('close')"
  >
    <p class="notice notice--warn">
      本规则属于「筑瞳 Demo 演示预警规则 V1.0」，用于验证系统流程，**不是国家建筑安全标准**，
      也不代表建筑危险极限。正式阈值须由结构专业人员结合建筑类型、结构状态、历史数据与设计要求核定。
    </p>
    <FormGrid v-model="model" :fields="fields" :errors="errors" />
    <p v-if="submitError !== ''" class="notice notice--warn submit-error">保存失败：{{ submitError }}</p>
    <template #footer>
      <AppButton @click="emit('close')">取消</AppButton>
      <AppButton variant="primary" :loading="pending" @click="submit">保存规则</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.notice {
  margin-bottom: 16px;
}
</style>

<script setup lang="ts">
/**
 * 录入时的分级预览：把当前判定结果按"判定依据 / 触发值 / 规则阈值 / 生效基准"展示。
 * 与保存后的正式判定共用 assessPoint，因此预览与落库结果不会打架。
 */
import type { Baseline } from '@/types/domain'
import type { MonitoringRule, RuleAssessment } from '@/types/rules'
import { stateLabel, stateTone } from '@/core/rules'
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import StatusTag from '@/components/ui/StatusTag.vue'

const props = defineProps<{
  rule: MonitoringRule
  baseline: Baseline | undefined
  result: RuleAssessment
  /** 采样时间的可读文本，用于说明基准按哪个时刻选取 */
  sampledAtText: string
}>()

function thresholdText(rule: MonitoringRule): string {
  const t = rule.thresholds
  return t === null ? '环境条件' : `黄 ${t.yellow} / 橙 ${t.orange} / 红 ${t.red}`
}
</script>

<template>
  <div class="level-box">
    <div class="row-between">
      <StatusTag :tone="stateTone(props.result.state)" :text="stateLabel(props.result.state)" />
      <span class="code">{{ props.rule.code }} · {{ props.rule.version }}</span>
    </div>
    <dl class="level-kv">
      <div><dt>判定依据</dt><dd>{{ props.result.basis === '' ? '—' : props.result.basis }}</dd></div>
      <div>
        <dt>触发值</dt>
        <dd class="num">
          {{ props.result.triggerValue === null ? '—' : `${fmtNumber(props.result.triggerValue, 2)} ${props.rule.unit}` }}
        </dd>
      </div>
      <div><dt>规则阈值</dt><dd class="num">{{ thresholdText(props.rule) }}</dd></div>
      <div>
        <dt>生效基准</dt>
        <dd class="num">
          {{ props.baseline === undefined ? '该指标不设基准' : `v${props.baseline.version}（${formatDateTime(props.baseline.effectiveFrom)} 起）` }}
        </dd>
      </div>
    </dl>
    <p class="field-hint">
      基准与规则版本均按<strong>采样时间</strong>选取：{{ props.sampledAtText }} 时{{ props.baseline === undefined ? '无生效基准' : `生效的是 v${props.baseline.version}` }}。未来生效的基准不会参与本次录入。
    </p>
    <p v-if="props.result.insufficientReason !== ''" class="field-hint">{{ props.result.insufficientReason }}</p>
    <p class="field-hint">按「{{ props.rule.source }}」实算，用于演示分级。</p>
  </div>
</template>

<style scoped>
.level-box {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--canvas);
}

.level-kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 10px 0 6px;
}

.level-kv dt {
  font-size: 11.5px;
  color: var(--text-3);
}

.level-kv dd {
  margin: 0;
  font-size: 13px;
}
</style>

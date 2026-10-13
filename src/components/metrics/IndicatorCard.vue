<script setup lang="ts">
/**
 * 单个管理指标卡片：把**定义、分子、分母、时间范围、不纳入条件**和结果一起显示。
 * 分母为 0 时显示"暂无数据"，不显示 0% 或 100%（那会被读成"全都没按期"或"全部按期"）。
 */
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import type { Indicator } from '@/core/metrics/indicators'

const props = defineProps<{
  indicator: Indicator
  /** 当前时间范围的可读描述，例如 2026-09-16 ~ 2026-09-22 或 不限时间 */
  rangeText: string
  buildingText: string
  /** 点击排除项时把清单带到对应工作台 */
  onLocate?: (label: string) => void
}>()

function display(): string {
  if (props.indicator.value === null) return '暂无数据'
  return props.indicator.kind === 'hours'
    ? `${props.indicator.value.toFixed(1)} 小时`
    : `${(props.indicator.value * 100).toFixed(1)}%`
}
</script>

<template>
  <SectionCard :title="indicator.name" :sub="indicator.definition">
    <div class="metric">
      <div class="metric-value" :class="{ 'metric-value--empty': indicator.value === null }">{{ display() }}</div>
      <div class="metric-facts">
        <div><span class="code">分子</span>{{ indicator.numerator.label }}：<b class="num">{{ indicator.numerator.value }}</b></div>
        <div><span class="code">分母</span>{{ indicator.denominator.label }}：<b class="num">{{ indicator.denominator.value }}</b></div>
        <div><span class="code">范围</span>{{ rangeText }}；{{ buildingText }}</div>
        <div v-if="indicator.extra !== ''"><span class="code">参考</span>{{ indicator.extra }}</div>
      </div>
    </div>
    <div v-for="item in indicator.exclusions.filter((row) => row.count > 0)" :key="item.label" class="exclusion">
      <StatusTag tone="line" :text="`不纳入 ${item.count}`" />
      <span class="exclusion-label">{{ item.label }}</span>
      <span class="code">{{ item.samples.join('、') }}</span>
      <button v-if="onLocate" class="link" type="button" @click="onLocate(item.label)">去处理</button>
    </div>
    <p v-if="indicator.exclusions.every((row) => row.count === 0)" class="code">本范围内没有需要排除的对象。</p>
  </SectionCard>
</template>

<style scoped>
.metric {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.metric-value {
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  min-width: 150px;
}

.metric-value--empty {
  font-size: 18px;
  color: var(--text-3);
  font-weight: 500;
}

.metric-facts {
  display: grid;
  gap: 4px;
  font-size: 13px;
  color: var(--text-2);
  flex: 1;
  min-width: 320px;
}

.metric-facts b {
  color: var(--text-1);
}

.exclusion {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-2);
  flex-wrap: wrap;
}

.exclusion-label {
  max-width: 520px;
}

.link {
  border: 0;
  background: none;
  color: var(--brand-600);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
</style>

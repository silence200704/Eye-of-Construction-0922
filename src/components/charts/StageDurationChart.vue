<script setup lang="ts">
/**
 * 处置阶段平均耗时（横向条形图）：事件生成 → 派工 → 完工提交 → 验收。
 *
 * 只有能连起来的段才计入平均；卡住的条数、时间倒挂的条数在下方如实列出 ——
 * 缺样本的阶段不画成 0 小时，否则"卡在哪一步"会被平均掉。
 */
import { computed } from 'vue'
import VChart from 'vue-echarts'
import ChartPanel from './ChartPanel.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { PANEL_GRID, type PanelOption } from './echartsSetup'
import type { StageDuration, StageDurationModel } from '@/core/chart/dashboard'

const props = defineProps<{ model: StageDurationModel }>()
const emit = defineEmits<{ selectPending: [] }>()

const BRAND = '#1a7f8c'

function labelOf(param: unknown, stages: StageDuration[]): string {
  const index = (param as { dataIndex?: number }).dataIndex
  const stage = index === undefined ? undefined : stages[index]
  if (stage === undefined || stage.hours === null) return ''
  return `${stage.hours} 小时（${stage.count} 条）`
}

const option = computed<PanelOption>(() => {
  const stages = props.model.stages
  return {
    grid: { ...PANEL_GRID, top: 16, right: 76 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const index = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number } | undefined
        const stage = index?.dataIndex === undefined ? undefined : stages[index.dataIndex]
        if (stage === undefined) return ''
        return stage.hours === null
          ? `${stage.label}<br/>暂无可用样本（不按 0 小时计）`
          : `${stage.label}<br/>平均 ${stage.hours} 小时｜样本 ${stage.count} 条`
      },
    },
    xAxis: { type: 'value', name: '小时', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'category', data: stages.map((row) => row.label), axisLabel: { fontSize: 11 } },
    series: [
      {
        name: '平均耗时',
        type: 'bar',
        barMaxWidth: 26,
        itemStyle: { color: BRAND },
        data: stages.map((row) => ({ value: row.hours, count: row.count })),
        label: { show: true, position: 'right', fontSize: 10, formatter: (param: unknown) => labelOf(param, stages) },
      },
    ],
  }
})

const hasSample = computed(() => props.model.stages.some((row) => row.hours !== null))
</script>

<template>
  <div class="wrap">
    <ChartPanel :empty="model.total === 0 ? model.emptyText : ''" :hint="model.total === 0 ? '当前筛选范围内没有工单，没有可算的阶段耗时' : ''">
      <VChart class="chart" :option="option" :style="{ height: '190px' }" autoresize @click="emit('selectPending')" />
    </ChartPanel>
    <ul v-if="model.total > 0" class="facts">
      <li v-if="!hasSample">三个阶段都还没有可用样本：工单还没走完对应环节，平均耗时留空而不是按 0 计。</li>
      <li>
        纳入统计 {{ model.total }} 条工单｜卡住：未派工 {{ model.pending.assign }} 条、未完工提交 {{ model.pending.submit }} 条、未验收 {{ model.pending.review }} 条
        <span v-if="model.inconsistent > 0">｜时间倒挂无法计入 {{ model.inconsistent }} 条</span>
      </li>
      <li>只有带预警事件的工单才计入"事件生成 → 派工"；人工上报与巡检发现的工单从派工起算。</li>
    </ul>
    <p v-if="hasSample" class="hint">
      各段耗时按记录中的业务时间计算；临时数据包含预设历史案例，所示耗时为模拟测试值，不代表现场实际处理速度。极短间隔按一位小数可能显示 0.0 小时。
    </p>
    <div class="actions">
      <AppButton size="sm" @click="emit('selectPending')">查看未验收通过的工单</AppButton>
    </div>
  </div>
</template>

<style scoped>
.wrap { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 6px; }
.chart { width: 100%; }
.facts { margin: 0; padding-left: 18px; color: var(--text-3); font-size: 11.5px; line-height: 1.8; }
.hint { margin: 0; color: var(--text-3); font-size: 11.5px; line-height: 1.7; }
.actions { display: flex; gap: 8px; }
</style>

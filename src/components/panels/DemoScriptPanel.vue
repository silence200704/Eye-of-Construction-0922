<script setup lang="ts">
/**
 * 一键演示脚本面板（答辩用）。
 *
 * 一次性导入标准演示数据，走的是正常录入路径，因此事件、证据链、升级历史与通知
 * 全部由规则判定真实生成，不是预置结果。数据标注为演示脚本导入、
 * 采样时间早于当前时间，会按历史补录标记，不伪装成实时预警。
 */
import { computed, ref } from 'vue'
import { runDemoScript, simulateOverdueNotifications, type DemoRunResult } from '@/stores/writes/demoWrites'
import { useEventsStore } from '@/stores/events'
import SectionCard from '@/components/ui/SectionCard.vue'
import DataTable from '@/components/ui/DataTable.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const events = useEventsStore()

const running = ref(false)
const result = ref<DemoRunResult | null>(null)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')

const latestEventId = computed(() => (result.value?.eventNo === '' ? '' : (events.sorted.find((row) => row.eventNo === result.value?.eventNo)?.id ?? '')))

/**
 * 只对标准表给了确定状态的行做比对。
 * 恢复过程按"连续 3 条"判定，出现行次取决于该测点已有记录，逐条比对没有意义。
 */
const compared = computed(() => (result.value?.rows ?? []).filter((row) => row.expectState !== null))
const mismatches = computed(() => compared.value.filter((row) => row.actualState !== row.expectState))

async function run(): Promise<void> {
  running.value = true
  message.value = ''
  try {
    result.value = await runDemoScript()
    tone.value = 'ok'
    message.value = `已生成 ${result.value.created} 条记录（跳过 ${result.value.skipped} 条已存在的）`
  } catch (cause) {
    tone.value = 'bad'
    message.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    running.value = false
  }
}

async function simulate(): Promise<void> {
  const eventId = latestEventId.value
  if (eventId === '') {
    tone.value = 'bad'
    message.value = '先执行一键生成，再模拟超时通知'
    return
  }
  const out = await simulateOverdueNotifications(eventId)
  tone.value = out.escalated === 0 ? 'bad' : 'ok'
  message.value =
    out.escalated === 0 ? '该事件没有未确认的通知可模拟升级' : `已把 ${out.escalated} 条未确认通知标记为升级（演示模拟）`
}
</script>

<template>
  <SectionCard
    title="一键演示脚本"
    sub="答辩用：一次导入标准演示数据，事件与通知由规则判定真实生成"
    marked
  >
    <p class="notice notice--warn">
      写入的数据来自项目组《筑瞳 Demo 演示预警规则 V1.0》的演示数据脚本，<b>会记入正式的监测记录与预警事件</b>。
      采样时间按剧本落在过去，因此每条都会标注为<b>历史补录</b>，不会伪装成实时预警。
      演示前建议先「清空并转为空白模式」或重新载入示例校区，保持现场数据干净。
    </p>

    <div class="row wrap">
      <AppButton variant="primary" :disabled="running" @click="run">
        {{ running ? '正在生成…' : '一键生成演示数据' }}
      </AppButton>
      <AppButton :disabled="result === null" @click="simulate">模拟超时通知（演示）</AppButton>
    </div>

    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <template v-if="result !== null">
      <div class="grid-4 summary">
        <div class="kpi">
          <div class="kpi-label">生成事件</div>
          <div class="kpi-value">{{ result.eventNo === '' ? '无' : '1' }}</div>
          <div class="kpi-foot">{{ result.eventNo === '' ? '未越限，未生成事件' : result.eventNo }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">证据条数</div>
          <div class="kpi-value">{{ result.evidences }}</div>
          <div class="kpi-foot">同点同规则未关闭只追加证据</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">升级次数</div>
          <div class="kpi-value">{{ result.upgrades }}</div>
          <div class="kpi-foot">黄 → 橙 → 红</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">通知条数</div>
          <div class="kpi-value">{{ result.notifications }}</div>
          <div class="kpi-foot">按等级通知对应角色</div>
        </div>
      </div>

      <DataTable
        :columns="[
          { key: 'label', label: '阶段', width: '160px' },
          { key: 'expect', label: '标准预期结果', width: '160px' },
          { key: 'actual', label: '实算数据状态' },
          { key: 'verdict', label: '比对', width: '110px' },
        ]"
        :row-count="result.rows.length"
      >
        <tr v-for="item in result.rows" :key="item.label">
          <td>{{ item.label }}</td>
          <td class="muted">{{ item.expect }}</td>
          <td>
            <StatusTag
              :tone="item.actual.includes('红') ? 'red' : item.actual.includes('橙') ? 'orange' : item.actual.includes('黄') ? 'yellow' : item.actual.includes('恢复') ? 'brand' : 'green'"
              :text="item.actual"
            />
          </td>
          <td>
            <StatusTag v-if="item.expectState === null" tone="line" text="按序列判定" :dot="false" />
            <StatusTag v-else-if="item.actualState === item.expectState" tone="green" text="一致" />
            <StatusTag v-else tone="red" text="不一致" />
          </td>
        </tr>
      </DataTable>

      <p v-if="mismatches.length === 0" class="field-hint">
        前 {{ compared.length }} 条绝对值分级与标准预期一致；恢复过程按"连续 3 条"判定，出现行次取决于该测点已有记录。
      </p>
      <p v-else class="notice notice--warn">
        有 {{ mismatches.length }} 条与标准预期不一致，请在「预警标准」页核对规则版本与阈值。
      </p>
    </template>
  </SectionCard>
</template>

<style scoped>
.summary {
  margin: 14px 0;
}

.notice {
  margin-bottom: 12px;
}
</style>

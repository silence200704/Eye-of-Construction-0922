<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FULL_CHAIN_LABEL } from '@/config/demoScenarios'
import { isShowcase, switchWorkspace } from '@/core/demo/workspace'
import { formatDateTime } from '@/core/time'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import type { FullChainOutcome } from '@/stores/writes/demo/chain'
import AppButton from '@/components/ui/AppButton.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import ManualDataResults from './ManualDataResults.vue'

const demo = useDemoScenarioStore()
const autoPrepare = ref(false)
const outcome = ref<FullChainOutcome | null>(null)
const error = ref('')
const busy = computed(() => demo.isRunning('fullChain'))
const last = computed(() => demo.last.fullChain)
const failed = computed(() => error.value !== '' || (outcome.value !== null
  ? !outcome.value.liveOk || !outcome.value.chainOk || outcome.value.results.some((row) => !row.ok)
  : last.value?.failed === true))
const message = computed(() => error.value || outcome.value?.message || last.value?.message || '')

onMounted(() => { void demo.refresh() })

async function importData(): Promise<void> {
  // 自动演示库的23阶段使用独立对象，不能用旧样例提前处置它的主链。
  if (isShowcase || busy.value) return
  error.value = ''
  outcome.value = null
  try {
    outcome.value = await demo.loadChain({ autoPrepare: autoPrepare.value })
  } catch (cause) {
    error.value = `临时数据导入失败：${cause instanceof Error ? cause.message : String(cause)}；已完成的场景保留，可重试。`
  }
}
</script>

<template>
  <SectionCard title="手动操作演示" sub="先一键导入临时数据，再自行查看看板、操作预警、派工维修、巡检与保养" marked>
    <section aria-label="手动导入临时数据" :aria-busy="busy">
      <div class="manual-intro">
        <span class="mode-tag">只准备数据</span>
        <p>导入后停留在当前页，不启动完整自动演示、不自动跳转。包含待办理案例和历史样例；你可以选择待处理案例，按原业务表单亲手操作。</p>
      </div>
      <p v-if="isShowcase" class="notice notice--brand">
        当前是独立自动演示库。手动导入在主库中进行，返回主库后使用下方同一入口，不修改自动演示进度。
      </p>
      <template v-else>
        <label class="prepare-option"><input v-model="autoPrepare" type="checkbox" :disabled="busy" />同时允许小瞳在本次会话按需补齐临时数据（可选）</label>
        <p class="hint">可重复点击，已有数据按业务键复用；保留已办理进度，不清空主库。数据为演示预设值，照片和视频素材按原测点登记。</p>
      </template>
      <div class="row wrap">
        <AppButton v-if="isShowcase" @click="switchWorkspace('main')">返回主库，准备手动演示</AppButton>
        <AppButton v-else variant="primary" :disabled="busy" @click="importData">{{ busy ? '正在导入临时数据…' : FULL_CHAIN_LABEL }}</AppButton>
        <span class="hint">{{ isShowcase ? '自动演示数据独立保存' : '手动导入临时数据 · 不自动办理' }}</span>
      </div>
      <p v-if="message" class="notice" :class="failed ? 'notice--warn' : 'notice--brand'" role="status">{{ message }}</p>
      <p v-if="last" class="hint">上次导入：{{ formatDateTime(last.at) }}{{ outcome === null ? ' · 以下为上次导入回执，当前状态请打开原业务页面核对' : '' }}</p>
      <ManualDataResults v-if="demo.chainResults.length" :rows="demo.chainResults" :chain-line="demo.chainLine" />
    </section>
  </SectionCard>
</template>

<style scoped>
.manual-intro { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.manual-intro p { margin: 0; font-size: 13px; line-height: 1.8; color: var(--text-2); }
.mode-tag { flex-shrink: 0; padding: 5px 9px; border-radius: var(--r-sm); background: var(--brand-050); color: var(--brand-700); font-size: 12px; font-weight: 600; }
.prepare-option { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
.prepare-option input { accent-color: var(--brand-600); }
.hint { margin: 10px 0; color: var(--text-3); font-size: 12px; line-height: 1.7; }
.notice { margin: 14px 0 8px; overflow-wrap: anywhere; }
</style>

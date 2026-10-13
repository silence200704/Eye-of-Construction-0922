<script setup lang="ts">
import { onMounted } from 'vue'
import { isShowcase, switchWorkspace } from '@/core/demo/workspace'
import { useShowcaseStore } from '@/stores/demo/showcase/session'
import { useAssistantStore } from '@/assistant/session'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import FeatureResult from '@/components/assistant/preview/FeatureResult.vue'
import VideoEvidencePreview from '@/components/assistant/preview/VideoEvidencePreview.vue'
import AppButton from '@/components/ui/AppButton.vue'
const demo = useShowcaseStore()
const assistant = useAssistantStore()
const dataImport = useDemoScenarioStore()
const props = defineProps<{ compact?: boolean }>()
onMounted(() => { if (props.compact) void demo.autoStart() })
async function ask(): Promise<void> { await demo.pause(); assistant.open = true; assistant.context = demo.answer?.context ?? { pointId: 'pnt_b03_f2_crack01', eventId: demo.refs.eventId || undefined } }
const questions = ['比较B03-F3-CRACK01和B03-F3-CRACK02最近24小时的读数','回放当前事件的升级过程','以前有类似的裂缝问题吗？','试算黄色阈值改为0.15毫米，最近7天哪些记录会改变等级？','分析当前测点的视频','现在办理到哪一步了？']
async function preset(question: string): Promise<void> { await ask(); assistant.context = { pointId: 'pnt_b03_f2_crack01', eventId: demo.refs.eventId || undefined }; await assistant.ask(question) }
</script>
<template>
  <section class="showcase" :class="{ compact }" aria-label="完整自动演示">
    <div class="heading"><b>{{ isShowcase ? '独立演示库' : '完整自动演示' }}</b><span v-if="isShowcase">{{ demo.state.next }}/{{ demo.total }} · {{ demo.currentLabel }}</span></div>
    <p v-if="!compact">一次启动，通过原业务接口完成预警、问题、工单、验收、复查和关闭，并自动展示比较、回放、试算、视频、巡检、保养与报告。演示输入明确标记为模拟，结果保存在独立演示库。</p>
    <div class="buttons">
      <AppButton v-if="demo.state.status !== 'completed'" variant="primary" :disabled="demo.running || dataImport.isRunning('fullChain')" @click="demo.start()">{{ demo.running ? '正在自动执行' : demo.state.next ? '继续演示／重试' : '开始完整演示' }}</AppButton>
      <AppButton v-if="isShowcase && demo.running" @click="demo.pause()">暂停</AppButton>
      <AppButton v-if="isShowcase" @click="ask">自由提问</AppButton>
      <AppButton v-if="isShowcase" @click="demo.stop()">停止</AppButton>
      <AppButton v-if="isShowcase" @click="demo.reset(true)">重新演示</AppButton>
      <AppButton v-if="isShowcase && !compact" @click="demo.reset()">仅复位演示库</AppButton>
      <AppButton v-if="isShowcase" @click="switchWorkspace('main')">返回主库</AppButton>
    </div>
    <p v-if="demo.state.error || demo.message" class="notice" role="status">{{ demo.state.error || demo.message }}</p>
    <details v-if="isShowcase && !demo.running"><summary>可问问题（自动绑定演示对象）</summary><div class="buttons"><AppButton v-for="question in questions" :key="question" size="sm" @click="preset(question)">{{ question }}</AppButton></div></details>
    <details v-if="demo.answer" open class="result"><summary>{{ demo.answer.conclusion }}</summary>
      <FeatureResult v-for="preview in demo.answer.previews.filter(p => ['point_compare','event_replay','case_search','rule_simulate'].includes(p.kind))" :key="preview.kind" :preview="preview" />
      <template v-for="(preview,index) in demo.answer.previews" :key="index"><VideoEvidencePreview v-if="preview.kind === 'video_evidence'" :preview="preview" /></template>
      <p v-for="fact in demo.answer.facts" :key="fact.label">{{ fact.label }}：{{ fact.value }} {{ fact.unit }}</p>
    </details>
  </section>
</template>
<style scoped>
.showcase { padding: 16px; background: var(--paper); border: 1px solid var(--line-strong); border-radius: var(--r-sm); }.heading,.buttons { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }.heading { justify-content:space-between; margin-bottom:8px; }.showcase p { font-size:12px; line-height:1.6; }.compact { position:sticky; top:0; z-index:11000; border-color:var(--brand-500); }.compact .notice { margin:6px 0 0; }.result { max-height:260px; overflow:auto; margin-top:10px; }.result summary { font-size:13px; cursor:pointer; }
</style>

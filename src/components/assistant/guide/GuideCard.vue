<script setup lang="ts">
/**
 * 导览卡：只读地说明"现在走到哪一步、下一步谁负责、还缺什么"。
 *
 * 阶段**不是**在渲染里现算的：它来自 `assistant.guidePlan`，只在明确时机由
 * `assistant.rereadGuide()` 重读数据库后更新（打开导览、从业务页返回、点「刷新数据」）。
 * 这样既保证"每次都以数据库为准"，又不会在每次响应式渲染中反复读库。
 *
 * 卡片**不做任何写入**：需要人判断的动作只给原业务表单或演示页面的深链。
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { GuideStage } from '@/assistant/guide/stage'
import { buildLink } from '@/assistant/actions'
import { useAssistantStore } from '@/assistant/session'
import type { AskLink } from '@/assistant/types'
import AppButton from '@/components/ui/AppButton.vue'

const emit = defineEmits<{ navigate: [link: AskLink] }>()
const assistant = useAssistantStore()
const route = useRoute()
const plan = computed(() => assistant.guidePlan)

/** 从业务页返回（路由变化）时重读阶段：页面里刚做完的动作要立刻反映到导览上。 */
watch(
  () => route.fullPath,
  () => {
    if (assistant.guideActive) void assistant.rereadGuide()
  },
)

/** 阶段的中文名：与事件详情页的处置流程用语保持一致。 */
const STAGE_LABEL: Record<GuideStage, string> = {
  prepare: '准备',
  event_pending: '预警待确认',
  issue_missing: '待转问题',
  issue_review: '问题待审核',
  issue_investigating: '问题转排查',
  work_order_dispatch: '工单待派工',
  work_order_repair: '维修处理中',
  work_order_verify: '待验收',
  issue_recheck: '待复查',
  issue_observing: '观察中',
  issue_closed: '问题已关闭',
  event_closed: '事件已关闭',
  chain_broken: '链路待人工核对',
  stale: '事件已失效',
}

const stageLabel = computed(() => (plan.value === null ? '' : STAGE_LABEL[plan.value.stage]))
const refs = computed(() => {
  const row = plan.value
  if (row === null) return ''
  return [
    row.eventNo === '' ? '' : `事件 ${row.eventNo}`,
    row.issueNo === '' ? '' : `问题 ${row.issueNo}`,
    row.orderNo === '' ? '' : `工单 ${row.orderNo}`,
  ].filter((item) => item !== '').join(' · ')
})

const settingsLink = buildLink('settings')
</script>

<template>
  <section v-if="assistant.guideActive" class="guide" aria-label="处置进度">
    <div class="head">
      <div>
        <small v-if="plan !== null">处置进度 · {{ plan.step }}/{{ plan.totalSteps }} · {{ stageLabel }}</small>
        <small v-else>处置进度</small>
        <h3>{{ plan === null ? '正在按当前数据库读取阶段…' : plan.title }}</h3>
      </div>
      <button type="button" class="end" @click="assistant.endGuide()">收起进度</button>
    </div>

    <p v-if="assistant.guideLoading" class="loading">正在按当前数据库重新读取事件、问题与工单…</p>
    <template v-else-if="plan !== null">
      <p>{{ plan.detail }}</p>
      <p v-if="refs !== ''" class="ref">{{ refs }} · 按当前数据读出，不代表全链已完成</p>
      <p v-if="plan.nextRole !== ''" class="role">下一责任角色：<b>{{ plan.nextRole }}</b></p>
      <ul v-if="plan.missing.length > 0" class="missing">
        <li v-for="item in plan.missing" :key="item">仍缺：{{ item }}</li>
      </ul>
      <p v-for="gap in plan.gaps" :key="gap" class="gap">{{ gap }}</p>
      <p v-for="note in plan.verifyNotes" :key="note" class="verify">归属说明：{{ note }}</p>
      <div v-if="plan.candidates.length > 0" class="candidates">
        <p>需要先选定（不替人挑编号）：</p>
        <AppButton v-for="row in plan.candidates" :key="row.id" size="sm" @click="emit('navigate', row.link)">
          {{ row.label }}
        </AppButton>
      </div>
      <div class="actions">
        <AppButton v-if="plan.canPrepare && assistant.guideCanPrepare" size="sm" variant="primary" @click="emit('navigate', settingsLink)">
          到系统设置载入全链数据
        </AppButton>
        <AppButton v-if="plan.link !== null" size="sm" variant="primary" @click="emit('navigate', plan.link)">
          {{ plan.link.label }}
        </AppButton>
        <AppButton v-for="link in plan.extraLinks" :key="link.kind" size="sm" @click="emit('navigate', link)">
          {{ link.label }}
        </AppButton>
        <AppButton size="sm" @click="assistant.rereadGuide()">重新读取阶段</AppButton>
      </div>
      <details class="related">
        <summary>关联影像与巡检</summary>
      <div v-if="plan.demoLinks.length > 0" class="demo">
        <p class="demo-head">相关功能（打开已有页面，业务数据由原表单办理）</p>
        <div class="actions">
          <AppButton v-for="link in plan.demoLinks" :key="link.kind" size="sm" @click="emit('navigate', link)">
            {{ link.label }}
          </AppButton>
        </div>
        <p v-for="link in plan.demoLinks" :key="`${link.kind}-note`" class="demo-note">{{ link.label }}：{{ link.note }}</p>
      </div>

      <div class="nfc">
        <p class="demo-head">模拟 NFC 到点（到点结论由现场任务页判定）</p>
        <template v-if="plan.nfc.ready">
          <p class="nfc-ref">
            任务 {{ plan.nfc.taskNo }}（计划 {{ plan.nfc.planCode }}）<template v-if="plan.nfc.pointCode !== ''"> · 目标点位 {{ plan.nfc.pointCode }} {{ plan.nfc.pointName }}</template>
          </p>
          <ol class="nfc-steps">
            <li v-for="step in plan.nfc.steps" :key="step">{{ step }}</li>
          </ol>
          <p v-if="plan.nfc.arrivedPointCodes.length > 0" class="demo-note">
            已到点：{{ plan.nfc.arrivedPointCodes.join('、') }}（可展开到点尝试历史看失败留痕）
          </p>
        </template>
        <template v-else>
          <p class="nfc-ref">当前没有可用的巡检任务</p>
          <ol class="nfc-steps">
            <li v-for="step in plan.nfc.steps" :key="step">{{ step }}</li>
          </ol>
          <p class="demo-note">{{ plan.nfc.prepareNote }}</p>
          <AppButton size="sm" variant="primary" @click="emit('navigate', settingsLink)">到系统设置载入全链数据</AppButton>
        </template>
        <p class="demo-note">{{ plan.nfc.note }}</p>
      </div>
      </details>
    </template>
    <p v-else class="loading">阶段暂不可用：请点「重新读取阶段」，或先在预警中心选定一条事件。</p>

    <p class="note">小瞳已核对当前处置进度；派工、接单、验收、复查结论与事件关闭由人在原业务表单完成。</p>
  </section>
</template>

<style scoped>
.guide { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--brand-500); border-radius: var(--r-md); background: var(--brand-050); }
.head { display: flex; justify-content: space-between; align-items: start; gap: 10px; }
.head small { color: var(--brand-700); font-size: 11px; }
.head h3 { margin: 2px 0 0; font-size: 14px; }
.end { border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 11px; cursor: pointer; }
.guide p { margin: 0; color: var(--text-2); font-size: 12px; line-height: 1.6; }
.guide .ref { color: var(--brand-700); font-family: var(--font-mono); font-size: 11px; }
.guide .role b { color: var(--text-1); }
.guide .loading { color: var(--brand-700); }
.guide .missing { margin: 0; padding-left: 16px; color: var(--text-2); font-size: 12px; line-height: 1.7; }
.guide .gap { color: var(--st-orange-ink, #a15c00); }
.guide .verify { color: var(--st-yellow-ink, #7a6100); font-size: 11.5px; }
.guide .candidates { display: grid; gap: 6px; }
.guide .demo { display: grid; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--line-strong); }
.guide .demo-head { color: var(--text-1); font-size: 11.5px; }
.guide .nfc { display: grid; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--line-strong); }
.guide .nfc-ref { color: var(--brand-700); font-family: var(--font-mono); font-size: 11px; }
.guide .nfc-steps { margin: 0; padding-left: 18px; color: var(--text-2); font-size: 12px; line-height: 1.7; }
.guide .demo-note { font-size: 11px; color: var(--text-3); }
.guide .note { font-size: 11px; color: var(--text-3); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.related summary { cursor: pointer; color: var(--brand-700); font-size: 12px; padding: 6px 0; }
</style>

<script setup lang="ts">
/**
 * 一条问答的渲染：按 `AskResult` 出结论、数值、时间与来源、证据、空态说明与操作链接。
 *
 * 三条界面纪律：
 * 1. `gaps` 与 `dataNotes` **必须展示**，不能被折叠成一句"正常"——
 *    它们写的正是"缺什么、这个数是什么口径"；
 * 2. 只读导航只用回答里给的 `links`，不自己拼 URL、不自己猜对象；
 * 3. 临时演示数据只给系统设置的导航，不在回答卡提供第二个载入按钮。
 */
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { extractEntities, normalizeQuestion, parseIntent } from '@/assistant/parse'
import { backendActive } from '@/api/backend/runtime'
import { formatDateTime } from '@/core/time'
import { DEMO_LIVE_SOURCE_LABEL } from '@/types/catalog'
import type { AskCandidate, AskLink, AskResult } from '@/assistant/types'
import { mascotStateOf, useAssistantStore, type AskTurn, type VisualAction } from '@/assistant/session'
import { useAnswerReveal } from './reveal/useAnswerReveal'
import StatusTag from '@/components/ui/StatusTag.vue'
import XiaotongAvatar from './XiaotongAvatar.vue'
import AnswerFailure from './presentation/AnswerFailure.vue'
import AnswerSources from './presentation/AnswerSources.vue'
import FeatureResult from './preview/FeatureResult.vue'
const PointTrendPreview = defineAsyncComponent(() => import('./preview/PointTrendPreview.vue'))
const VideoEvidencePreview = defineAsyncComponent(() => import('./preview/VideoEvidencePreview.vue'))
const MediaPairPreview = defineAsyncComponent(() => import('./preview/MediaPairPreview.vue'))
const VisualEvidencePreview = defineAsyncComponent(() => import('./preview/VisualEvidencePreview.vue'))

const props = defineProps<{ turn: AskTurn; active: boolean }>()
const emit = defineEmits<{
  navigate: [link: AskLink]
  choose: [candidate: AskCandidate]
  /** 视觉证据卡上的区域/框选操作：同一条回答内更新，不新增轮次 */
  visual: [turnId: string, action: VisualAction]
}>()

/**
 * 卡片底部已经放了「3D 定位 / 预警依据 / 完整影像对比」这三个主要去向，
 * 常规链接行里就不重复出现它们 —— 同一条回答里同一组按钮出现两次会让人以为点错了。
 */
const CARD_LINK_KINDS: AskLink['kind'][] = ['spatial_3d', 'event_detail', 'media_page']
const hasVisualCard = computed(() => (props.turn.result?.previews ?? []).some((row) => row.kind === 'visual_evidence'))

const assistant = useAssistantStore()

/**
 * 视觉证据联动的四步是本演示**真实走过的流水线**（编排按完成情况上报阶段）：
 * 读取监测记录 → 核对关联影像 → 计算区域差异 → 整理结果。
 * 其它问法沿用三步固定说法（那三步也确实是问答层做的事）。
 */
const VISUAL_STEPS = ['读取监测记录', '核对关联影像', '计算区域差异', '整理结果']
const VIDEO_STEPS = ['核对测点与授权', '读取视频并解码', '抽帧与计算区域差异', '整理视频与监测证据']
const GENERIC_STEPS = ['识别问法与对象', '读取当前本地数据', '整理结论与证据']
const genericSteps = computed(() => backendActive()
  ? ['识别问法与对象', '读取当前服务端数据', '整理结论与证据']
  : GENERIC_STEPS)

/**
 * 回答还没落地时也要先把流程显示对，所以这里用**问答层同一个解析器**判断问句属于哪一类 ——
 * 不在界面里另写一套关键词，免得"解析成影像问法、界面显示视觉四步"这种两套口径。
 */
const looksVisual = computed(() => {
  if (props.turn.result !== null) {
    return props.turn.result.intent === 'visual_evidence' || props.turn.result.intent === 'visual_region' || props.turn.result.intent === 'video_compare'
  }
  const q = normalizeQuestion(props.turn.question)
  const intent = parseIntent(q, extractEntities(q))
  return intent === 'visual_evidence' || intent === 'visual_region' || intent === 'video_compare'
})
const thoughtSteps = ref<string[]>([...genericSteps.value])

const { phase, thinkingStep, stepCount, shown, showAll } = useAnswerReveal({
  turn: () => props.turn,
  active: () => props.active,
  complete: (id) => assistant.markPresented(id),
  steps: () => thoughtSteps.value,
})

watch(looksVisual, (visual) => { thoughtSteps.value = visual ? (/视频|关键帧|短片/.test(props.turn.question) ? VIDEO_STEPS : VISUAL_STEPS) : [...genericSteps.value] }, { immediate: true })

/** 导览进行中、且这条回答讲的就是事件处置：要标明它可能已经不是当前阶段。 */
const staleInGuide = computed(() => {
  if (!assistant.guideActive) return false
  const intent = props.turn.result?.intent ?? null
  return intent === 'demo_guide' || intent === 'event_reason'
})

const STATUS: Record<AskResult['status'], { text: string; tone: 'green' | 'orange' | 'gray' }> = {
  answered: { text: '已按当前数据回答', tone: 'green' },
  need_choice: { text: '需要你选定对象', tone: 'orange' },
  not_found: { text: '当前数据集没有可用结果', tone: 'gray' },
  unsupported: { text: '这一类问题本步不支持', tone: 'gray' },
  awaiting_confirmation: { text: '等待人工确认', tone: 'orange' },
}

const INTENT_TEXT: Record<AskResult['intent'], string> = {
  point_compare: '双测点比较', event_replay: '真实事件回放', case_search: '相似案例检索', rule_simulate: '候选阈值试算',
  campus_overview: '全校概况',
  point_status: '单测点状态',
  event_reason: '预警原因',
  issue_status: '问题与工单',
  knowledge: '知识说明',
  open_events: '未处理队列',
  media_compare: '影像对比',
  media_reason: '影像结论依据',
  point_trend: '读数趋势',
  capabilities: '功能与操作说明',
  video_compare: '视频证据与关键帧',
  visual_evidence: '数值与影像证据',
  visual_region: '影像区域操作',
  reading_recovery: '读数是否恢复',
  spatial_go: '3D 位置',
  demo_command: '演示指令',
  demo_guide: '演示导览',
  unknown: '未识别问法',
}

interface Row { label: string; value: string }

/** 采样时间与录入时间分列展示：这两件事要分得清，不合并成一个"时间"。 */
function timingRows(result: AskResult): Row[] {
  const t = result.timing
  if (t === null) return []
  return [
    // 一律按本地时间展示：同一张卡里出现 UTC ISO 与本地时间两种写法会让人以为差了 8 小时
    { label: '采样时间', value: formatDateTime(t.sampleTime) },
    { label: '录入时间', value: formatDateTime(t.enteredAt) },
    { label: '数据性质', value: t.isBackfill
      ? '历史补录（不代表实时上报）'
      : result.provenance?.sourceLabel === DEMO_LIVE_SOURCE_LABEL ? DEMO_LIVE_SOURCE_LABEL : '常规记录' },
    ...(t.revision > 0 ? [{ label: '修订', value: `已被修订 ${t.revision} 次，当前值为修订后数值` }] : []),
  ]
}

function provenanceRows(result: AskResult): Row[] {
  const p = result.provenance
  if (p === null) return []
  return [
    { label: '来源', value: p.sourceLabel },
    { label: '质量标记', value: p.qualityNote === '' ? p.qualityLabel : `${p.qualityLabel}（${p.qualityNote}）` },
    { label: '测点档案', value: p.pointDataSourceLabel },
    { label: '设备状态', value: p.deviceHealthLabel },
  ]
}

/** 这条回答对应的形象状态：与悬浮入口同一套状态语义 */
const answerState = computed(() => mascotStateOf(props.turn.result))

/** 回答里实际要渲染的链接行：有视觉证据卡时，卡片已承接的那三个去向不重复列出。 */
const linkRows = computed(() => {
  const links = props.turn.result?.links ?? []
  return hasVisualCard.value ? links.filter((link) => !CARD_LINK_KINDS.includes(link.kind)) : links
})

/** 只给"不是直接定位"的链接配说明：deep 的链接点进去就是那个对象，不用多话。 */
const shallowLinks = computed(() => linkRows.value.filter((link) => !link.deep && link.note !== ''))
</script>

<template>
  <article class="turn">
    <p class="question">{{ turn.question }}</p>

    <AnswerFailure v-if="turn.error !== ''" :error="turn.error" />
    <div v-else-if="phase === 'thinking'" class="thinking" role="status" aria-live="polite">
      <div class="thinking-head">
        <XiaotongAvatar :state="'searching'" :size="38" />
        <div>
          <b>小瞳正在整理答案<span class="thinking-dots" aria-hidden="true">…</span></b>
          <p>{{ thoughtSteps[thinkingStep] }}</p>
        </div>
      </div>
      <div class="thinking-progress" aria-hidden="true">
        <i v-for="(step, index) in thoughtSteps" :key="step" :class="{ 'is-active': index <= thinkingStep }" />
      </div>
      <div class="thinking-foot">
        <small>{{ stepCount }} 个步骤按实际完成进度显示；{{ backendActive() ? '依据当前服务端业务数据与本地知识库，不调用在线 AI' : '依据当前本地数据与既有规则，不调用在线 AI' }}</small>
        <button type="button" class="skip" @click="showAll()">立即显示全部</button>
      </div>
    </div>
    <p v-else-if="turn.result === null" class="pending">正在等待读取结果…</p>

    <div v-else class="answer">
      <p v-if="phase === 'revealing'" class="reveal-count">
        正在逐条呈现核对结果
        <button type="button" class="skip" @click="showAll()">立即显示全部</button>
      </p>
      <div v-if="shown('summary')" class="reveal-part">
        <div class="answer-head">
          <XiaotongAvatar quiet :state="answerState" :size="26" />
          <StatusTag :tone="STATUS[turn.result.status].tone" :text="STATUS[turn.result.status].text" />
          <span class="meta">{{ turn.result.status === 'need_choice' ? '选择讨论对象' : INTENT_TEXT[turn.result.intent] }}｜数据截至 {{ formatDateTime(turn.result.computedAt) }}</span>
        </div>
        <p class="conclusion">{{ turn.result.conclusion }}</p>
        <p v-if="staleInGuide" class="stale-note">
          这条回答是提问当时按数据库读出的；当前处置阶段以上方「处置进度」卡片为准。
        </p>
      </div>

      <div v-if="shown('visual') && turn.result.previews.length > 0" class="reveal-part reveal-visual">
        <template v-for="(preview, index) in turn.result.previews" :key="`${preview.kind}-${index}`">
          <VisualEvidencePreview
            v-if="preview.kind === 'visual_evidence'"
            :preview="preview"
            :links="turn.result.links"
            @navigate="emit('navigate', $event)"
            @action="emit('visual', turn.id, $event)"
          />
          <PointTrendPreview v-else-if="preview.kind === 'point_trend'" :preview="preview" />
          <VideoEvidencePreview v-else-if="preview.kind === 'video_evidence'" :preview="preview" />
          <MediaPairPreview v-else-if="preview.kind === 'media_pair'" :preview="preview" />
          <FeatureResult v-else :preview="preview" />
        </template>
      </div>

      <dl v-if="shown('facts') && turn.result.facts.length > 0" class="facts reveal-part">
        <div v-for="fact in turn.result.facts" :key="`${fact.label}-${fact.value}`" class="fact">
          <dt>{{ fact.label }}</dt>
          <dd><b>{{ fact.value }}</b><span v-if="fact.unit !== ''" class="unit">{{ fact.unit }}</span></dd>
        </div>
      </dl>

      <div v-if="shown('source') && turn.result.timing !== null" class="block reveal-part">
        <p class="block-title">时间口径</p>
        <dl class="rows">
          <div v-for="row in timingRows(turn.result)" :key="row.label" class="row">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
        <p class="hint">{{ turn.result.timing.freshnessLabel }}</p>
      </div>

      <div v-if="shown('source') && turn.result.provenance !== null" class="block reveal-part">
        <p class="block-title">来源与质量</p>
        <dl class="rows">
          <div v-for="row in provenanceRows(turn.result)" :key="row.label" class="row">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </div>

      <AnswerSources
        v-if="shown('source') && (turn.result.sources !== undefined || turn.result.citations?.length)"
        :result="turn.result"
      />

      <div v-if="shown('evidence') && turn.result.evidence.length > 0" class="block reveal-part">
        <p class="block-title">证据（可与看板、详情逐条核对）</p>
        <ul class="evidence">
          <li v-for="item in turn.result.evidence" :key="item.id">
            <span class="ref">{{ item.ref }}</span>
            <span class="meta">{{ item.detail }}</span>
          </li>
        </ul>
      </div>

      <div v-if="shown('evidence') && turn.result.candidates.length > 0" class="block reveal-part">
        <p class="block-title">候选对象（点一条继续问，不会替你猜）</p>
        <div class="candidates">
          <button
            v-for="item in turn.result.candidates"
            :key="item.id"
            type="button"
            class="candidate"
            @click="emit('choose', item)"
          >
            <b>{{ item.label }}</b>
            <span class="meta">{{ item.detail }}</span>
          </button>
        </div>
      </div>

      <div v-if="shown('limits') && turn.result.gaps.length > 0" class="notice notice--warn gaps reveal-part">
        <p v-for="(text, index) in turn.result.gaps" :key="index">{{ text }}</p>
      </div>

      <div v-if="shown('limits') && turn.result.dataNotes.length > 0" class="notes reveal-part">
        <p class="block-title">数据口径</p>
        <p v-for="(text, index) in turn.result.dataNotes" :key="index">{{ text }}</p>
      </div>

      <div v-if="shown('links') && linkRows.length > 0" class="block actions reveal-part">
        <p class="block-title">打开相关页面</p>
        <div class="action-row">
          <button
            v-for="link in linkRows"
            :key="`${link.kind}-${link.path}`"
            type="button"
            class="action"
            @click="emit('navigate', link)"
          >
            {{ link.label }}
          </button>
        </div>
        <p v-for="link in shallowLinks" :key="`hint-${link.kind}-${link.path}`" class="hint">
          · {{ link.label }}：{{ link.note }}
        </p>
      </div>
      <div v-if="shown('links') && turn.result.followups?.length" class="action-row">
        <button v-for="question in turn.result.followups.slice(0,3)" :key="question" class="action" :disabled="assistant.busy" @click="assistant.ask(question)">{{ question }}</button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.turn { display: grid; gap: 8px; }

.question {
  margin: 0;
  justify-self: end;
  max-width: 90%;
  padding: 7px 12px;
  border-radius: var(--r-md);
  background: var(--brand-050);
  color: var(--brand-700);
  font-size: 13px;
  line-height: 1.5;
}

.pending { margin: 0; color: var(--text-3); font-size: 12.5px; }
.thinking { display: grid; gap: 10px; padding: 13px; border: 1px solid var(--brand-200); border-radius: var(--r-md); background: var(--brand-050); }
.thinking-head { display: flex; align-items: center; gap: 10px; }
.thinking-head b { color: var(--brand-700); font-size: 13px; }
.thinking-head p { margin: 3px 0 0; color: var(--text-2); font-size: 12px; }
.thinking small { color: var(--text-3); font-size: 11px; }
.thinking-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.skip {
  margin-left: auto;
  padding: 3px 8px;
  border: 1px solid var(--brand-300, var(--brand-200));
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--brand-700);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.skip:hover, .skip:focus-visible { border-color: var(--brand-500); }
.thinking-progress { display: flex; gap: 5px; }
.thinking-progress i { flex: 1; height: 3px; border-radius: 3px; background: var(--brand-200); }
.thinking-progress i.is-active { background: var(--brand-600); }
.thinking-dots { display: inline-block; animation: dots 0.9s ease-in-out infinite alternate; }
@keyframes dots { from { opacity: 0.35; } to { opacity: 1; } }

.answer {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--paper);
}
.reveal-part { animation: reveal-in 0.25s ease-out both; }
.reveal-visual { display: grid; gap: 9px; }
.reveal-count { margin: 0; color: var(--brand-700); font-size: 11px; }
@keyframes reveal-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .thinking-dots, .reveal-part { animation: none; }
}

.answer-head { display: flex; align-items: center; gap: 8px; }
.answer-head .meta { margin-left: auto; }

.conclusion { margin: 0; font-size: 14px; line-height: 1.75; color: var(--text); }

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
  margin: 0;
}

.fact { padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--canvas); }
.fact dt { color: var(--text-3); font-size: 12px; line-height: 1.5; }
.fact dd { margin: 6px 0 0; font-family: var(--font-mono); font-size: 17px; line-height: 1.4; overflow-wrap: anywhere; }
.fact .unit { margin-left: 2px; color: var(--text-2); font-size: 11px; }

.block { display: grid; gap: 5px; }
.block-title { margin: 0; color: var(--text-2); font-size: 11.5px; font-weight: 700; }

.rows { display: grid; gap: 3px; margin: 0; }
.row { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; font-size: 12px; }
.row dt { color: var(--text-3); }
.row dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }

.evidence { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.evidence li { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; font-size: 12px; }
.ref { font-family: var(--font-mono); color: var(--brand-700); }

.meta { color: var(--text-3); font-size: 11.5px; }
.stale-note { margin: 0; color: var(--brand-700); font-size: 11.5px; }
.muted { color: var(--text-2); font-size: 11.5px; }
.hint { margin: 0; color: var(--text-3); font-size: 11.5px; line-height: 1.5; }

.candidates { display: grid; gap: 6px; }
.candidate {
  display: grid;
  gap: 2px;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.candidate:hover, .candidate:focus-visible { border-color: var(--brand-500); background: var(--brand-050); }
.candidate b { font-size: 12.5px; }

.gaps { display: grid; gap: 3px; margin: 0; font-size: 12px; }
.gaps p { margin: 0; }

.notes { display: grid; gap: 3px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-sm); }
.notes p { margin: 0; color: var(--text-2); font-size: 11.5px; line-height: 1.5; }

.action-row { display: flex; flex-wrap: wrap; gap: 6px; }
.action {
  padding: 9px 12px;
  min-height: 40px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--brand-700);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.action:hover, .action:focus-visible { border-color: var(--brand-500); background: var(--brand-050); }
</style>

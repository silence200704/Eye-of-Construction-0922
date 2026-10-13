<script setup lang="ts">
/**
 * 视觉证据同屏卡（方案 §34/§36 的半屏布局）。
 *
 * 顺序固定：测点与来源 → 当前读数 / 历史峰值两张卡 → 关联事件 → 迷你趋势 →
 * 前后影像（带登记区域框）→ 区域差异摘要 → 三个主要去向。
 *
 * 四条界面纪律：
 * 1. **当前值与历史峰值分列**：峰值一律标着"事件证据"，不会被读成现在的值；
 * 2. 区域结论绑定测点、前后照片 ID、区域、比对时间，换区域就在这一条回答里更新；
 * 3. 预设区域是人工画的示范框，界面上不许出现"自动识别"这类说法；
 * 4. 放大是展示操作、框选是会话操作，都不写数据。
 */
import { computed, ref } from 'vue'
import { formatDateTime } from '@/core/time'
import { compareStatusLabel, type Region } from '@/core/media/compare'
import { useMediaStore } from '@/stores/media'
import { frameOriginLabel, type MediaCompareRecord } from '@/types/media'
import type { AskLink, AskRegionKey, AskVisualEvidencePreview } from '@/assistant/types'
import { mediaPairIsAvailable } from '@/assistant/preview/mediaPair'
import StatusTag from '@/components/ui/StatusTag.vue'
import PointTrendPreview from './PointTrendPreview.vue'
import MediaPairPreview from './MediaPairPreview.vue'

/** 卡上四个操作：三个区域切换 + 放大（放大只改本卡的展示倍数）。 */
export type VisualCardAction =
  | { kind: 'region'; key: 'crack' | 'control' }
  | { kind: 'custom'; region: Region }

const props = defineProps<{ preview: AskVisualEvidencePreview; links: AskLink[] }>()
const emit = defineEmits<{ action: [action: VisualCardAction]; navigate: [link: AskLink] }>()

const media = useMediaStore()
/** 放大倍数：1 = 原大；「放大对比」在 1 → 2 → 3 之间轮换 */
const zoom = ref(props.preview.zoom ? 2 : 1)
/** 正在"自己框选"：这时照片上可拖框，并先回到 1 倍，保证框选坐标不受缩放影响 */
const selecting = ref(false)

const activeName: Record<AskRegionKey, string> = {
  crack: '登记裂缝区',
  control: '完好墙面（对照）',
  custom: '你自己框选的区域',
}
/** 三个主要去向：卡片底部只放这三个，其余链接留在回答的常规链接行 */
const PRIMARY: AskLink['kind'][] = ['spatial_3d', 'event_detail', 'media_page']
const PRIMARY_LABEL: Partial<Record<AskLink['kind'], string>> = {
  spatial_3d: '3D 定位',
  event_detail: '预警依据',
  media_page: '完整影像对比',
}

const active = computed(() => props.preview.results[props.preview.active])
const other = computed(() =>
  props.preview.active === 'crack' ? props.preview.results.control : props.preview.results.crack,
)
const activeBox = computed<Region | null>(() => {
  if (props.preview.active === 'custom') return props.preview.results.custom?.region ?? null
  return props.preview.regions === null ? null : props.preview.regions[props.preview.active === 'control' ? 'control' : 'crack']
})
const primaryLinks = computed(() => props.links.filter((row) => PRIMARY.includes(row.kind)))
const pairAvailable = computed(() => props.preview.pair !== null && mediaPairIsAvailable(props.preview.pair, media.frames))

type MaybeRecord = MediaCompareRecord | null | undefined

/** 差异像素占比：只有真正算过才有数，没算过不许显示 0%。 */
function ratioOf(row: MaybeRecord): string {
  if (row === null || row === undefined) return '尚未计算'
  return row.status === 'incomparable' ? '不适用（不可比对）' : `${(row.changedRatio * 100).toFixed(1)}%`
}

function statusOf(row: MaybeRecord): string {
  return row === null || row === undefined ? '等待计算' : compareStatusLabel(row.status)
}

function toneOf(row: MaybeRecord): 'green' | 'orange' | 'gray' {
  if (row === null || row === undefined) return 'gray'
  return row.status === 'changed' ? 'orange' : row.status === 'stable' ? 'green' : 'gray'
}

/** 只有一张影像时，把那一张的来源与时间写清楚，别让人以为是"系统没读到图"。 */
function singleText(single: { origin: Parameters<typeof frameOriginLabel>[0]; capturedAt: string } | null): string {
  return single === null ? '没有影像' : `${frameOriginLabel(single.origin)} · ${formatDateTime(single.capturedAt)}`
}

/** 区域坐标原样给出：评审可以照着这几个数在图上核对同一块地方。 */
function regionText(region: Region): string {
  return `x ${(region.x * 100).toFixed(1)}% · y ${(region.y * 100).toFixed(1)}% · w ${(region.w * 100).toFixed(1)}% · h ${(region.h * 100).toFixed(1)}%（归一化，原点左上）`
}

function pick(key: 'crack' | 'control'): void {
  selecting.value = false
  emit('action', { kind: 'region', key })
}

function toggleSelect(): void {
  selecting.value = !selecting.value
  if (selecting.value) zoom.value = 1
}

function onCustom(region: Region): void {
  selecting.value = false
  emit('action', { kind: 'custom', region })
}
</script>

<template>
  <section class="visual">
    <header class="head">
      <span class="eyebrow">小瞳 · 视觉证据</span>
      <div class="who">
        <b class="code">{{ preview.pointCode }}</b>
        <span class="name">{{ preview.pointName }}</span>
      </div>
      <div class="badges">
        <StatusTag :tone="preview.source === 'builtin' ? 'orange' : 'gray'" :text="preview.source === 'builtin' ? '随包演示证据素材' : '当前会话影像'" />
        <span class="meta">{{ preview.location }}</span>
        <span class="meta">{{ preview.pointDataSourceLabel }}</span>
      </div>
    </header>

    <div class="numbers">
      <div class="num">
        <small>当前有效读数</small>
        <p v-if="preview.current !== null">
          <b>{{ preview.current.value }}</b><span class="unit">{{ preview.current.unit }}</span>
        </p>
        <p v-else class="empty">本机没有有效读数</p>
        <small v-if="preview.current !== null">
          {{ preview.current.label }} · 记录 {{ preview.current.recordNo }} · 采样 {{ formatDateTime(preview.current.sampleTime) }}
        </small>
        <small v-if="preview.current?.delta != null">相对基准 {{ preview.current.delta }}（{{ preview.current.deltaLabel }}）</small>
        <small v-if="preview.current !== null" class="fresh">{{ preview.current.freshnessLabel }}</small>
      </div>
      <div class="num num--peak">
        <small>历史峰值（事件证据，不是当前值）</small>
        <p v-if="preview.peak !== null">
          <b>{{ preview.peak.value }}</b><span class="unit">{{ preview.peak.unit }}</span>
        </p>
        <p v-else class="empty">没有可引的事件证据</p>
        <small v-if="preview.peak !== null">
          {{ preview.peak.label }} · {{ preview.peak.eventNo }}（{{ preview.peak.levelLabel }}）· 采样 {{ formatDateTime(preview.peak.sampleTime) }}
        </small>
        <small v-if="preview.peak !== null">{{ preview.peak.sourceNote }}</small>
      </div>
    </div>

    <p class="event-line">
      <template v-if="preview.event !== null">
        关联事件 <b>{{ preview.event.eventNo }}</b>（{{ preview.event.levelLabel }}）当前状态：{{ preview.event.statusLabel }}
      </template>
      <template v-else>该测点当前没有关联的预警事件。</template>
      <span class="meta"> · 等级与状态直接引用规则引擎结果，助手不重算阈值</span>
    </p>

    <PointTrendPreview v-if="preview.trend !== null" :preview="preview.trend" />

    <MediaPairPreview
      v-if="preview.pair !== null"
      :preview="preview.pair"
      :mask="active?.status !== 'incomparable' ? active?.mask : undefined"
      :box="activeBox"
      :box-label="activeName[preview.active]"
      :zoom="zoom"
      :selectable="selecting"
      @select="onCustom"
    />
    <p v-else class="single">
      当前只有一张可比影像（{{ singleText(preview.single) }}）：仅供裂缝形态参考，
      缺少可比影像，因此不做任何变化结论。
    </p>

    <div class="ops">
      <template v-if="preview.pair !== null && preview.regions !== null">
        <button type="button" :disabled="!pairAvailable || media.busy" :class="{ 'is-on': preview.active === 'crack' }" @click="pick('crack')">看裂缝区域</button>
        <button type="button" :disabled="!pairAvailable || media.busy" :class="{ 'is-on': preview.active === 'control' }" @click="pick('control')">看完好墙面</button>
      </template>
      <button v-if="preview.pair !== null" type="button" :disabled="!pairAvailable" @click="zoom = zoom === 1 ? 2 : zoom === 2 ? 3 : 1">
        放大对比（{{ zoom }}×）
      </button>
      <button v-if="preview.pair !== null" type="button" :disabled="!pairAvailable || media.busy" :class="{ 'is-on': selecting }" @click="toggleSelect">自己框选</button>
    </div>
    <p v-if="selecting" class="hint">在任意一张照片上按住拖动，框出一块区域；松手后按这块区域重新计算，更新在这条回答里。</p>

    <p v-if="preview.pair !== null && !pairAvailable" class="hint">这组会话影像已失效，旧区域结果不再适用；请重新提问。</p>
    <div v-else-if="pairAvailable" class="diff">
      <div class="diff-head">
        <b>{{ activeName[preview.active] }}</b>
        <StatusTag :tone="toneOf(active)" :text="statusOf(active)" />
        <span class="ratio">差异像素 {{ ratioOf(active) }}</span>
        <span v-if="media.busy" class="meta">正在计算…</span>
      </div>
      <p v-if="active !== null && active !== undefined" class="summary">{{ active.summary }}</p>
      <p v-else class="summary">这个区域还没有算过：点上面的按钮，或在照片上自己框一块。</p>
      <button v-if="other !== null && other !== undefined && preview.regions !== null" type="button" class="other evidence-jump" :disabled="media.busy" @click="pick(preview.active === 'crack' ? 'control' : 'crack')">
        对照：{{ activeName[preview.active === 'crack' ? 'control' : 'crack'] }} 差异像素 {{ ratioOf(other) }}，结论「{{ statusOf(other) }}」 · 点击定位此区域
      </button>
      <p v-if="preview.results.custom !== null" class="other">
        你自己的框：差异像素 {{ ratioOf(preview.results.custom) }}，结论「{{ statusOf(preview.results.custom) }}」
      </p>
      <dl v-if="active !== null && active !== undefined" class="rows">
        <div class="row">
          <dt>比对时间</dt>
          <dd>{{ formatDateTime(active.comparedAt) }}</dd>
        </div>
        <div class="row">
          <dt>绑定对象</dt>
          <dd>
            测点 {{ preview.pointCode }} · 照片 {{ active.beforeId }} / {{ active.afterId }}
          </dd>
        </div>
        <div class="row">
          <dt>区域坐标</dt>
          <dd>{{ regionText(active.region) }}</dd>
        </div>
      </dl>
      <p class="method">{{ preview.method }}</p>
      <p class="note">{{ preview.note }}</p>
    </div>

    <div v-if="primaryLinks.length > 0" class="to">
      <button v-for="link in primaryLinks" :key="link.kind" type="button" class="to-btn" @click="emit('navigate', link)">
        {{ PRIMARY_LABEL[link.kind] ?? link.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.evidence-jump { display: block; width: 100%; text-align: left; padding: 10px; border: 1px solid var(--line); background: white; border-radius: 6px; cursor: pointer; }
.evidence-jump:hover { border-color: var(--brand-600); }
.visual { display: grid; gap: 16px; padding: 18px; border: 1px solid var(--brand-200); border-radius: var(--r-lg); background: var(--paper); }
.head { display: grid; gap: 7px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.eyebrow { font-size: 11px; color: var(--brand-700); letter-spacing: .1em; font-weight: 700; }
.who { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
.code { font-family: var(--font-mono); color: var(--brand-700); font-size: 13px; }
.name { color: var(--text); font-size: 12.5px; }
.badges { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }

.numbers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.num { display: grid; align-content: start; gap: 8px; padding: 16px; border: 1px solid var(--brand-200); border-radius: var(--r-md); background: var(--brand-050); }
.num--peak { border-color: var(--line); background: var(--canvas); }
.num p { margin: 2px 0 6px; font-family: var(--font-mono); font-size: 32px; line-height: 1.2; color: var(--brand-700); letter-spacing: -.06em; }
.num--peak p { color: var(--text-2); }
.num small { color: var(--text-2); font-size: 12px; line-height: 1.6; }
.num .unit { margin-left: 2px; font-size: 11px; color: var(--text-2); }
.num .empty { font-size: 12.5px; color: var(--text-2); }
.fresh { color: var(--text-2); }
.event-line { margin: 0; font-size: 12px; color: var(--text); line-height: 1.5; }
.single { margin: 0; font-size: 12px; color: var(--warn-700, #9a5b15); line-height: 1.5; }

.ops { display: flex; flex-wrap: wrap; gap: 8px; }
.ops button {
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
.ops button.is-on { border-color: var(--brand-600); background: var(--brand-050); font-weight: 700; }
.ops button:hover, .ops button:focus-visible { border-color: var(--brand-500); }
.ops button:disabled { opacity: .5; cursor: not-allowed; }
.hint { margin: 0; color: var(--text-3); font-size: 11px; line-height: 1.5; }

.diff { display: grid; gap: 10px; padding: 16px; border: 1px solid var(--line); border-left: 3px solid var(--brand-500); border-radius: var(--r-md); background: var(--canvas); }
.diff-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.diff-head b { font-size: 12.5px; }
.ratio { margin-left: auto; font-family: var(--font-mono); font-size: 16px; color: var(--brand-700); }
.summary, .other, .method, .note { margin: 0; font-size: 12px; line-height: 1.7; }
.summary { color: var(--text); }
.other { color: var(--text-2); }
.method, .note { color: var(--text-3); }
.note { color: var(--brand-700); }
.rows { display: grid; gap: 3px; margin: 0; }
.row { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 8px; font-size: 11px; }
.row dt { color: var(--text-3); }
.row dd { margin: 0; color: var(--text-2); font-family: var(--font-mono); overflow-wrap: anywhere; }
.meta { color: var(--text-3); font-size: 11px; }

/* 窄屏：两张数值卡上下排列，避免数字被压成两行 */
@media (max-width: 720px) {
  .numbers { grid-template-columns: minmax(0, 1fr); }
}

.to { display: flex; flex-wrap: wrap; gap: 6px; }
.to-btn {
  padding: 10px 14px;
  min-height: 40px;
  border: 1px solid var(--brand-300, var(--brand-200));
  border-radius: var(--r-sm);
  background: var(--brand-050);
  color: var(--brand-700);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.to-btn:hover, .to-btn:focus-visible { border-color: var(--brand-500); }
</style>

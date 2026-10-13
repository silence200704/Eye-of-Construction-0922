<script setup lang="ts">
/**
 * 前后对比面板：选两张 → 在同一点位上**人工框选**同一区域 → 运行预设分析。
 *
 * 界面纪律：
 * - 没框选就不能出结论（预设分析只在框选区域内做，避免"整张图比一遍"这种没有指向性的结论）；
 * - 结论卡把状态、差异占比、口径与边界一起显示，不让"疑似变化"变成一句孤零零的判词；
 * - 不上标尺、不出现毫米数：没有标定就算不出物理宽度。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { clampRegion, compareStatusLabel, DEFAULT_COMPARE_OPTIONS, isUsableRegion, sameRegion, type Region } from '@/core/media/compare'
import { useMediaStore } from '@/stores/media'
import { frameOriginLabel, MEDIA_SESSION_NOTE, type MediaFrame } from '@/types/media'
import { formatDateTime } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps<{ pointId: string }>()
const media = useMediaStore()

const beforeId = ref('')
const afterId = ref('')
const region = ref<Region | null>(null)
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const urls = ref<Record<string, string>>({})

const frames = computed(() => media.framesOf(props.pointId))
const before = computed(() => frames.value.find((row) => row.id === beforeId.value) ?? null)
const after = computed(() => frames.value.find((row) => row.id === afterId.value) ?? null)
const result = computed(() => (media.compare !== null && media.compare.pointId === props.pointId ? media.compare : null))
const ready = computed(() => before.value !== null && after.value !== null && beforeId.value !== afterId.value)

/** 选择或框选变动后清掉旧结论，小瞳也就不会把旧区域的结果当成当前结果复述。 */
watch([beforeId, afterId, region], () => {
  const current = result.value
  if (current === null) return
  if (current.beforeId !== beforeId.value || current.afterId !== afterId.value
    || region.value === null || !sameRegion(current.region, region.value)) media.compare = null
}, { immediate: true })

/** 测点/影像变化时给出默认配对：最早一张对最晚一张，减少一次点击 */
watch(
  () => frames.value.map((row) => row.id).join(','),
  () => {
    for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
    const next: Record<string, string> = {}
    for (const frame of frames.value) next[frame.id] = URL.createObjectURL(frame.blob)
    urls.value = next

    const list = frames.value
    const generated = list.filter((row) => row.origin === 'demo_generated')
    const eligible = list.filter((row) => row.origin !== 'demo_public')
    const pair = generated.length >= 2 ? generated : eligible
    if (pair.length >= 2) {
      const selectedBefore = list.find((row) => row.id === beforeId.value)
      const selectedAfter = list.find((row) => row.id === afterId.value)
      if (selectedBefore === undefined || selectedBefore.origin === 'demo_public') beforeId.value = pair[0].id
      if (selectedAfter === undefined || selectedAfter.origin === 'demo_public') afterId.value = pair[pair.length - 1].id
    } else {
      beforeId.value = ''
      afterId.value = ''
    }
    region.value = null
  },
  { immediate: true },
)

onUnmounted(() => {
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
})

/** 在"前一张"上按下并拖动 → 归一化区域（滚轮与缩放都不影响，因为用元素自身矩形换算） */
function onPointerDown(event: PointerEvent): void {
  if (before.value === null) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dragging.value = true
  dragStart.value = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  region.value = clampRegion({ x: dragStart.value.x, y: dragStart.value.y, w: 0, h: 0 })
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  region.value = clampRegion({
    x: Math.min(dragStart.value.x, x),
    y: Math.min(dragStart.value.y, y),
    w: Math.abs(x - dragStart.value.x),
    h: Math.abs(y - dragStart.value.y),
  })
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  if (region.value !== null && !isUsableRegion(region.value)) {
    region.value = null
    media.notify('框选区域太小，请拖出一个明确的区域（至少覆盖画面的 1%）。', false)
  }
}

async function analyze(): Promise<void> {
  if (!ready.value || region.value === null) return
  await media.runCompare({ pointId: props.pointId, beforeId: beforeId.value, afterId: afterId.value, region: region.value })
}

function resetRegion(): void {
  region.value = null
}

function statusTone(status: 'changed' | 'stable' | 'incomparable'): 'orange' | 'green' | 'gray' {
  if (status === 'changed') return 'orange'
  if (status === 'stable') return 'green'
  return 'gray'
}

/** 结论边界：与问答口径同一套话术，界面与回答不许各说各的 */
const bounds = computed(() => [
  '结论来自像素级亮度差异统计，属于预设分析，不是裂缝识别。',
  '没有标定，因此不给宽度（毫米）等物理量；需要数值请走监测记录与预警判定。',
  '影像差异不会自动生成正式结构预警，是否处置由人工判断。',
  MEDIA_SESSION_NOTE,
])

function frameLabel(frame: MediaFrame): string {
  if (frame.origin === 'video_frame') {
    const code = frame.timeCode === null ? '时间码未登记' : `${frame.timeCode.toFixed(1)} 秒`
    return `${frameOriginLabel(frame.origin)}｜${code}｜会话读取 ${formatDateTime(frame.capturedAt)}`
  }
  const timeKind = frame.origin === 'demo_public' ? '载入时间'
    : frame.origin === 'demo_generated' || frame.origin === 'demo_evidence' ? '模拟展示时间' : '拍摄时间'
  return `${frameOriginLabel(frame.origin)}｜${timeKind} ${formatDateTime(frame.capturedAt)}`
}

/** 框选层与真正可见的图片等大，容器的留白不参与坐标换算。 */
function imageStageStyle(frame: MediaFrame): { aspectRatio: string; maxWidth: string } {
  return {
    aspectRatio: `${frame.width} / ${frame.height}`,
    maxWidth: `${(260 * frame.width) / frame.height}px`,
  }
}
</script>

<template>
  <SectionCard title="前后对比（预设分析）" sub="人工框选同一区域后，只做像素级差异统计：疑似变化 / 未见明显差异 / 不可比对；不给毫米数">
    <EmptyState
      v-if="frames.length < 2"
      title="至少需要两张同一测点的影像"
      sub="已准备的测点可在上方点「问小瞳查看这组视觉证据」，按需读取照片并计算示范区域；也可上传两张同位置照片后手动框选。公开参考图仅供展示。"
    />
    <div v-else class="stack">
      <div class="pickers">
        <label class="filter">
          <span>前一张</span>
          <select v-model="beforeId" class="ctl">
            <option v-for="frame in frames" :key="frame.id" :value="frame.id" :disabled="frame.origin === 'demo_public'">{{ frameLabel(frame) }}</option>
          </select>
        </label>
        <label class="filter">
          <span>后一张</span>
          <select v-model="afterId" class="ctl">
            <option v-for="frame in frames" :key="frame.id" :value="frame.id" :disabled="frame.origin === 'demo_public'">{{ frameLabel(frame) }}</option>
          </select>
        </label>
      </div>
      <p v-if="!ready" class="notice notice--warn">前一张与后一张不能是同一张影像。</p>

      <div class="compare">
        <figure class="pane">
          <figcaption>前一张（在这一张上按住拖动，框出要比对的区域）</figcaption>
          <div class="canvas">
            <div
              v-if="before !== null"
              class="image-stage"
              :style="imageStageStyle(before)"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
            >
              <img :src="urls[before.id]" :alt="before.label" draggable="false" />
              <span
                v-if="region !== null"
                class="mark"
                :style="{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.w * 100}%`,
                  height: `${region.h * 100}%`,
                }"
              />
            </div>
          </div>
        </figure>
        <figure class="pane">
          <figcaption>后一张（同一区域）</figcaption>
          <div class="canvas">
            <div v-if="after !== null" class="image-stage" :style="imageStageStyle(after)">
              <img :src="urls[after.id]" :alt="after.label" draggable="false" />
              <span
                v-if="region !== null"
                class="mark"
                :style="{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.w * 100}%`,
                  height: `${region.h * 100}%`,
                }"
              />
            </div>
          </div>
        </figure>
      </div>

      <div class="row wrap">
        <AppButton size="sm" variant="primary" :disabled="!ready || region === null || media.busy" @click="analyze">
          {{ media.busy ? '正在比对…' : '运行预设分析' }}
        </AppButton>
        <AppButton size="sm" :disabled="region === null" @click="resetRegion">清除框选</AppButton>
        <span class="muted">
          框选：{{ region === null ? '未框选' : `${(region.w * 100).toFixed(0)}% × ${(region.h * 100).toFixed(0)}%` }}｜
          阈值：像素差 ≥ {{ DEFAULT_COMPARE_OPTIONS.pixelDelta }}、差异占比 > {{ (DEFAULT_COMPARE_OPTIONS.changedRatio * 100).toFixed(0) }}%
        </span>
      </div>

      <div v-if="result !== null" class="result">
        <div class="row wrap">
          <StatusTag :tone="statusTone(result.status)" :text="compareStatusLabel(result.status)" />
          <span class="muted">比对时间 {{ formatDateTime(result.comparedAt) }}｜{{ result.status === 'incomparable' ? '差异比例不适用（不可比对）' : `差异像素占比 ${(result.changedRatio * 100).toFixed(1)}%` }}</span>
        </div>
        <p class="conclusion">{{ result.summary }}</p>
        <ul class="bounds">
          <li v-for="(text, index) in bounds" :key="index">{{ text }}</li>
        </ul>
      </div>
    </div>
  </SectionCard>
</template>

<style scoped>
.stack { display: grid; gap: 10px; }
.pickers { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.compare { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.pane { margin: 0; display: grid; gap: 6px; }
.pane figcaption { font-size: 11.5px; color: var(--text-3); }
.canvas { display: flex; align-items: center; justify-content: center; min-height: 260px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); overflow: hidden; background: var(--canvas-deep); }
.image-stage { position: relative; width: 100%; touch-action: none; cursor: crosshair; }
.image-stage img { display: block; width: 100%; height: 100%; user-select: none; }
.mark { position: absolute; border: 2px solid var(--brand-500); background: rgba(20, 134, 149, 0.12); pointer-events: none; }
.result { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--canvas); }
.conclusion { margin: 0; font-size: 13px; line-height: 1.6; }
.bounds { margin: 0; padding-left: 18px; color: var(--text-2); font-size: 11.5px; line-height: 1.6; }
.muted { color: var(--text-3); font-size: 11.5px; }
</style>

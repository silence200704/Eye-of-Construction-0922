<script setup lang="ts">
/**
 * 回答内的照片对（视觉证据与影像对比共用）。
 *
 * 只做展示：两张同一测点的影像、必要时的登记区域框、以及必须一起展示的口径说明。
 * 判定结论不在这里算 —— 区域差异由调用方（视觉证据卡）按测点与照片绑定后展示。
 *
 * 两张图共用同一个放大倍数与同一个原点（高亮区域中心），所以是**同步放大**；
 * 区域框画在缩放层里，跟着图片一起缩放，前后两张的位置始终对得上。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { formatDateTime } from '@/core/time'
import type { Region, PixelMask } from '@/core/media/compare'
import { useMediaStore } from '@/stores/media'
import { backendActive } from '@/api/backend/runtime'
import { frameOriginLabel, type MediaFrame } from '@/types/media'
import type { AskMediaPairPreview } from '@/assistant/types'
import PhotoCompareStage from './compare/PhotoCompareStage.vue'
import RegionSelectOverlay from './RegionSelectOverlay.vue'

const props = withDefaults(
  defineProps<{
    mask?: PixelMask
    preview: AskMediaPairPreview
    /** 要高亮的区域；null 表示不画框 */
    box?: Region | null
    /** 框上的名字 */
    boxLabel?: string
    /** 放大倍数：1 = 原大，两张图同步 */
    zoom?: number
    /** 允许在照片上拖出新的区域 */
    selectable?: boolean
  }>(),
  { box: null, boxLabel: '', zoom: 1, selectable: false },
)

const emit = defineEmits<{ select: [region: Region] }>()

const media = useMediaStore()
const pair = ref<{ frame: MediaFrame; url: string }[]>([])

function release(): void {
  for (const item of pair.value) URL.revokeObjectURL(item.url)
  pair.value = []
}

watch(
  () => [props.preview.beforeId, props.preview.afterId, media.frames],
  () => {
    release()
    const found = [props.preview.beforeId, props.preview.afterId]
      .map((id) => media.frames.find((row) => row.id === id && row.pointId === props.preview.pointId))
    // 旧回答里的照片被移除或刷新后取不到：照实说失效，不换成别的图顶上
    if (found.some((row) => row === undefined)) return
    pair.value = (found as MediaFrame[]).map((frame) => ({ frame, url: URL.createObjectURL(frame.blob) }))
  },
  { immediate: true },
)

onBeforeUnmount(release)

/** 按真实像素比例给出容器宽高比：框的位置用百分比定位，比例不一致就会错位。 */
function frameStyle(item: { frame: MediaFrame }): Record<string, string> {
  return { aspectRatio: `${item.frame.width} / ${item.frame.height}` }
}

function boxStyle(region: Region): Record<string, string> {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.w * 100}%`,
    height: `${region.h * 100}%`,
  }
}

/** 放大时以高亮区域中心为原点：两张图同一个原点，看上去就是同一处被放大。 */
const origin = computed(() => {
  const box = props.box
  if (box === null) return '50% 50%'
  return `${(box.x + box.w / 2) * 100}% ${(box.y + box.h / 2) * 100}%`
})

const sourceLabel = computed(() => (props.preview.source === 'builtin' ? '随包演示素材' : '当前会话影像'))
</script>

<template>
  <figure class="preview">
    <figcaption>
      <b>证据影像</b>
      <span>{{ sourceLabel }}</span>
    </figcaption>
    <PhotoCompareStage v-if="pair.length === 2 && !selectable" :key="`${preview.beforeId}:${preview.afterId}`"
      :before="pair[0]" :after="pair[1]" :mask="mask" :box="box" :box-label="boxLabel" :zoom="zoom" :origin="origin" />
    <div v-if="pair.length === 2 && selectable" class="pair">
      <div v-for="(item, index) in pair" :key="item.frame.id" class="frame">
        <div class="shot" :style="frameStyle(item)">
          <div class="zoom-layer" :style="{ transform: `scale(${props.zoom})`, transformOrigin: origin }">
            <img :src="item.url" :alt="`${index === 0 ? '前一张' : '后一张'}：${item.frame.label}`" />
            <span v-if="props.box !== null" class="box" :style="boxStyle(props.box)">
              <i>{{ props.boxLabel }}</i>
            </span>
          </div>
          <RegionSelectOverlay v-if="props.selectable" @select="emit('select', $event)" />
        </div>
        <b class="tag">{{ index === 0 ? '前一张' : '后一张' }}</b>
        <small>{{ item.frame.label }} · {{ frameOriginLabel(item.frame.origin) }}</small>
        <small>{{ item.frame.origin === 'demo_evidence' || item.frame.origin === 'demo_generated' ? '模拟展示时间' : item.frame.origin === 'demo_public' ? '载入时间' : '拍摄时间' }}：{{ formatDateTime(item.frame.capturedAt) }}</small>
      </div>
    </div>
    <p v-if="pair.length !== 2" class="missing">这组会话影像已失效：请到影像对比页重新加入后再问，或重新提问按需读取演示素材。</p>
    <p v-if="props.preview.note !== ''" class="note">{{ props.preview.note }}</p>
    <p class="boundary">图片仅供前后目视核对；{{ backendActive() ? '关键帧已保存到服务端' : '刷新即失' }}，不自动识别裂缝或生成预警。</p>
  </figure>
</template>

<style scoped>
.preview { margin: 0; padding: 14px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper); }
figcaption { display: flex; justify-content: space-between; color: var(--text); font-size: 14px; }
figcaption span, small, p { color: var(--text-2); font-size: 12px; }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.frame { display: grid; min-width: 0; gap: 6px; }
.shot { position: relative; width: 100%; overflow: hidden; border-radius: var(--r-sm); background: var(--paper); }
.zoom-layer { position: absolute; inset: 0; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }
.box { position: absolute; border: 1.5px solid var(--brand-600); box-shadow: 0 0 0 9999px rgb(15 23 42 / 22%); }
.box i {
  position: absolute;
  left: 0;
  top: -16px;
  padding: 1px 4px;
  border-radius: var(--r-sm);
  background: var(--brand-600);
  color: #fff;
  font-size: 10px;
  font-style: normal;
  white-space: nowrap;
}
.tag { color: var(--brand-700); font-size: 12px; }
/* 窄屏（半屏面板全屏形态）：两张照片上下排列，区域框仍然按百分比对位 */
@media (max-width: 720px) {
  .pair { grid-template-columns: minmax(0, 1fr); }
}
small { overflow-wrap: anywhere; line-height: 1.35; }
p { margin: 7px 0 0; line-height: 1.4; }
.note { color: var(--brand-700); }
.missing { color: var(--warn-700, #9a5b15); }
</style>

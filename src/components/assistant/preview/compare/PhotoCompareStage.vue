<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { PixelMask, Region } from '@/core/media/compare'
import { maskRgba } from '@/core/media/mask'
import type { MediaFrame } from '@/types/media'
import { frameOriginLabel } from '@/types/media'
import { formatDateTime } from '@/core/time'

type Photo = { frame: MediaFrame; url: string }
const props = defineProps<{ before: Photo; after: Photo; mask?: PixelMask; box: Region | null; boxLabel: string; zoom: number; origin: string }>()
const mode = ref<'pair' | 'wipe' | 'mask'>('pair')
const split = ref(50)
const opacity = ref(0.65)
const canvas = ref<HTMLCanvasElement | null>(null)
const aligned = computed(() => props.before.frame.width === props.after.frame.width && props.before.frame.height === props.after.frame.height)
const stageStyle = computed(() => ({ aspectRatio: `${props.before.frame.width} / ${props.before.frame.height}` }))
const zoomStyle = computed(() => ({ transform: `scale(${props.zoom})`, transformOrigin: props.origin }))
const boxStyle = computed(() => props.box ? { left: `${props.box.x * 100}%`, top: `${props.box.y * 100}%`, width: `${props.box.w * 100}%`, height: `${props.box.h * 100}%` } : {})
const photos = computed(() => [props.before, props.after])

async function draw(): Promise<void> {
  await nextTick()
  const target = canvas.value
  const mask = props.mask
  if (!target || !mask) return
  target.width = mask.width
  target.height = mask.height
  const ctx = target.getContext('2d')
  if (!ctx) return
  const data = ctx.createImageData(mask.width, mask.height)
  data.data.set(maskRgba(mask))
  ctx.putImageData(data, 0, 0)
}

watch(() => [props.mask, mode.value], () => {
  if (mode.value === 'mask' && !props.mask) mode.value = 'pair'
  void draw()
})
watch(aligned, (value) => { if (!value) mode.value = 'pair' })
</script>

<template>
  <div class="compare-stage">
    <div class="toolbar" role="group" aria-label="照片查看方式">
      <button type="button" :aria-pressed="mode === 'pair'" @click="mode = 'pair'">并排查看</button>
      <button type="button" :disabled="!aligned" :aria-pressed="mode === 'wipe'" @click="mode = 'wipe'">前后滑杆</button>
      <button type="button" :disabled="!aligned || !mask" :aria-pressed="mode === 'mask'" @click="mode = 'mask'">差异叠层</button>
    </div>
    <div v-if="mode === 'pair'" class="pair">
      <div v-for="(photo, index) in photos" :key="photo.frame.id" class="photo">
        <div class="stage" :style="{ aspectRatio: `${photo.frame.width} / ${photo.frame.height}` }">
          <div class="layer" :style="zoomStyle">
            <img :src="photo.url" :alt="`${index ? '后一张' : '前一张'}：${photo.frame.label}`" />
            <span v-if="box" class="box" :style="boxStyle"><i>{{ boxLabel }}</i></span>
          </div>
        </div>
        <b>{{ index ? '后一张' : '前一张' }}</b>
      </div>
    </div>
    <div v-else class="stage combined" :style="stageStyle">
      <div class="layer" :style="zoomStyle">
        <img :src="before.url" alt="前一张照片" />
        <img v-if="mode === 'wipe'" class="after" :src="after.url" alt="后一张照片" :style="{ clipPath: `inset(0 0 0 ${split}%)` }" />
        <canvas v-if="mode === 'mask'" ref="canvas" class="mask" :style="{ opacity }" aria-label="实际变化像素叠层" />
        <span v-if="box" class="box" :style="boxStyle"><i>{{ boxLabel }}</i></span>
        <span v-if="mode === 'wipe'" class="divider" :style="{ left: `${split}%` }" />
      </div>
      <span class="corner">前一张</span><span v-if="mode === 'wipe'" class="corner right">后一张</span>
    </div>
    <label v-if="mode === 'wipe'" class="control">前后分界 · {{ split }}%<input v-model.number="split" type="range" min="0" max="100" step="1" aria-label="前后照片分界位置" /></label>
    <label v-if="mode === 'mask'" class="control">叠层强度<input v-model.number="opacity" type="range" min="0.2" max="1" step="0.05" aria-label="变化像素叠层透明度" /></label>
    <p v-if="mode === 'mask'" class="legend"><span />橙色为本次所选区域内达到亮度差阈值的像素；区域外未分析，不代表没有变化。</p>
    <p v-if="!mask" class="hint">差异叠层需有效的区域计算结果；不可比对时不显示变化标记。</p>
    <div class="sources">
      <small v-for="(photo, index) in photos" :key="photo.frame.id">{{ index ? '后' : '前' }}：{{ frameOriginLabel(photo.frame.origin) }} · {{ photo.frame.label }} · {{ formatDateTime(photo.frame.capturedAt) }}{{ ['demo_evidence', 'demo_generated'].includes(photo.frame.origin) ? '（模拟展示时间）' : '' }}</small>
    </div>
  </div>
</template>

<style scoped>
.compare-stage { margin-top: 14px; }
.toolbar { display: flex; gap: 6px; padding-bottom: 12px; }
button { background: white; border: 1px solid #d8e0e5; color: #455761; padding: 7px 11px; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; }
button[aria-pressed="true"] { background: #135c73; color: white; border-color: #135c73; }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid #2683a0; outline-offset: 3px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.photo { min-width: 0; display: grid; gap: 6px; }
.photo b { font-size: 12px; color: #135c73; }
.stage { position: relative; overflow: hidden; background: #f2f4f5; border-radius: 6px; width: 100%; }
.layer { position: absolute; inset: 0; }
img { display: block; width: 100%; height: 100%; object-fit: contain; }
.after, .mask { position: absolute; inset: 0; width: 100%; height: 100%; }
.mask { pointer-events: none; }
.divider { position: absolute; top: 0; bottom: 0; width: 2px; background: white; box-shadow: 0 0 0 1px #135c73; pointer-events: none; }
.box { position: absolute; border: 1.5px solid #16869a; pointer-events: none; }
.box i { position: absolute; bottom: 100%; left: 0; background: #135c73; color: white; font-style: normal; font-size: 10px; white-space: nowrap; padding: 2px 4px; }
.corner { position: absolute; top: 8px; left: 8px; font-size: 11px; color: white; background: #172f3ccc; padding: 4px 7px; border-radius: 4px; pointer-events: none; }
.right { left: auto; right: 8px; }
.control { display: flex; align-items: center; gap: 14px; padding: 12px 0; font-size: 12px; color: #455761; }
input { flex: 1; accent-color: #135c73; }
.legend, .hint { font-size: 11px; line-height: 1.5; color: #60717b; margin: 8px 0; }
.legend span { display: inline-block; width: 8px; height: 8px; background: #ff6d22; margin-right: 6px; }
.sources { display: grid; gap: 4px; padding-top: 10px; border-top: 1px solid #e4e9ec; }
small { font-size: 11px; line-height: 1.5; color: #60717b; overflow-wrap: anywhere; }
</style>

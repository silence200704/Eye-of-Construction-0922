<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMediaStore } from '@/stores/media'
import type { SessionVideo, VideoAnalysis } from '@/types/media/video'
import { VIDEO_BOUNDARY, VIDEO_REGIONS } from '@/config/media/demoVideos'

const props = defineProps<{ video: SessionVideo; frameIds: string[]; analysis: VideoAnalysis | null; seekTime?: number; autoplay?: boolean }>()
const media = useMediaStore()
const player = ref<HTMLVideoElement | null>(null)
const urls = ref<Record<string, string>>({})
const activeRegion = ref<'crack' | 'control'>('crack')
const frames = computed(() => props.frameIds.map((id) => media.frames.find((row) => row.id === id && row.videoId === props.video.id && row.pointId === props.video.pointId)).filter((row) => row !== undefined))
const valid = computed(() => media.videoMeta?.id === props.video.id && frames.value.length === props.frameIds.length)
const result = computed(() => props.analysis?.regions[activeRegion.value])
const regionStyle = computed(() => {
  const r = VIDEO_REGIONS[activeRegion.value]
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }
})
function dispose(): void { Object.values(urls.value).forEach((url) => URL.revokeObjectURL(url)); urls.value = {} }
watch(() => frames.value.map((row) => row.id).join(','), () => {
  dispose()
  urls.value = Object.fromEntries(frames.value.map((row) => [row.id, URL.createObjectURL(row.blob)]))
}, { immediate: true })
onBeforeUnmount(dispose)
function seek(time: number): void { if (player.value) { player.value.currentTime = time; player.value.pause() } }
function applyRequestedSeek(): void {
  if (!player.value || props.seekTime === undefined || !valid.value) return
  player.value.currentTime = props.seekTime
  if (props.autoplay) void player.value.play().catch(() => {})
}
watch(() => props.seekTime,applyRequestedSeek,{ flush: 'post' })
</script>

<template>
  <section class="video-evidence" aria-label="视频证据">
    <div class="video-heading"><b>{{ video.title }}</b><span>{{ video.durationSeconds.toFixed(1) }} 秒 · {{ video.width }}×{{ video.height }}</span></div>
    <p v-if="!valid" class="notice notice--warn">这段会话视频或关键帧已失效，请重新发起视频演示。旧回答不会替换成另一段视频。</p>
    <template v-else>
      <video ref="player" :src="media.videoUrl" controls muted playsinline preload="metadata" class="player" aria-label="视频回放" @loadedmetadata="applyRequestedSeek" />
      <div class="filmstrip">
        <button v-for="(frame, index) in frames" :key="frame.id" type="button" @click="seek(frame.timeCode ?? 0)">
          <span class="frame-image"><img :src="urls[frame.id]" :alt="`关键帧 ${frame.timeCode?.toFixed(1)} 秒`" /><i v-if="video.comparable" :style="regionStyle" /></span>
          <b>{{ index === 0 ? '首帧' : index === 1 ? '中帧' : '末帧' }}</b><span>{{ frame.timeCode?.toFixed(1) }} s · 点击定位</span>
        </button>
      </div>
      <template v-if="analysis">
        <div v-if="video.comparable" class="region-controls" aria-label="对比区域">
          <button type="button" :aria-pressed="activeRegion === 'crack'" @click="activeRegion = 'crack'">裂缝区域</button>
          <button type="button" :aria-pressed="activeRegion === 'control'" @click="activeRegion = 'control'">完好墙面</button>
        </div>
        <div v-if="result" class="comparison-result"><strong>{{ result.status === 'changed' ? '疑似变化' : result.status === 'stable' ? '未见明显差异' : '不可比对' }}</strong><b>{{ (result.changedRatio * 100).toFixed(1) }}<small>% 差异像素</small></b><p>{{ result.summary.replace(/\*\*/g, '') }}</p></div>
        <p v-else class="notice notice--warn">{{ analysis.reason || '尚无区域分析结果' }}</p>
      </template>
    </template>
    <p class="source">{{ video.source }} · {{ video.note }}</p>
    <p class="boundary">{{ VIDEO_BOUNDARY }}</p>
  </section>
</template>

<style scoped>
.video-evidence { display: grid; gap: 14px; min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper); }
.video-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.video-heading b { font-size: 15px; }.video-heading span,.source,.boundary { color: var(--text-3); font-size: 12px; line-height: 1.6; margin: 0; }
.player { display: block; width: 100%; max-height: 310px; background: #15282f; border-radius: var(--r-sm); }
.filmstrip { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; }.filmstrip button { display: grid; gap: 6px; padding: 7px; text-align: left; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--canvas); color: var(--text); cursor: pointer; }.filmstrip button:hover { border-color: var(--brand-500); }.filmstrip span { font-size: 11px; color: var(--text-2); }.frame-image { position: relative; display: block; }.frame-image img { display: block; width: 100%; height: auto; }.frame-image i { position: absolute; border: 2px solid #27c4c9; background: #27c4c91a; pointer-events: none; }
.region-controls { display: flex; gap: 8px; }.region-controls button { padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--canvas); color: var(--text-2); cursor: pointer; }.region-controls button[aria-pressed=true] { background: var(--brand-700); color: white; border-color: var(--brand-700); }
.comparison-result { padding: 14px; background: var(--canvas); border-radius: var(--r-sm); border-left: 3px solid var(--brand-500); }.comparison-result strong { color: var(--brand-700); }.comparison-result>b { float: right; font-size: 23px; font-variant-numeric: tabular-nums; }.comparison-result small { font-size: 11px; margin-left: 5px; font-weight: 400; }.comparison-result p { font-size: 12px; color: var(--text-2); line-height: 1.7; clear: both; margin: 9px 0 0; }
button:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 3px; }
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import { useMediaStore } from '@/stores/media'
import { useAssistantStore } from '@/assistant/session'
import { DEMO_VIDEOS } from '@/config/media/demoVideos'
import { evidencePreparedFor } from '@/stores/demo/evidence'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import VideoEvidence from './VideoEvidence.vue'

const props = defineProps<{ pointId: string }>()
const media = useMediaStore()
const assistant = useAssistantStore()
const archive = useArchiveStore()
const selection = ref('change')
const prepared = computed(() => evidencePreparedFor(props.pointId))
const video = computed(() => media.videoMeta?.pointId === props.pointId ? media.videoMeta : null)
const ids = computed(() => media.frames.filter((row) => row.videoId === video.value?.id && row.videoId !== undefined).map((row) => row.id))
const asset = computed(() => DEMO_VIDEOS.find((row) => row.key === selection.value)!)
function url(path: string): string { return `${import.meta.env.BASE_URL}${path.slice(1)}` }
async function ask(): Promise<void> {
  const point = archive.pointById(props.pointId)
  if (!point) return
  const question = selection.value === 'inspection' ? `分析 ${point.code} 的公开实拍视频` : `分析 ${point.code} 的固定机位视频首末关键帧`
  await assistant.openWith('point', point.id, point.name, question)
}
async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.pointId) return
  await media.pickVideo(file, props.pointId)
}
async function extract(): Promise<void> {
  media.busy = true
  try {
    await media.captureKeyframes(props.pointId, video.value?.title ?? '本地视频')
    await media.analyseVideo()
    media.notify('已抽出三个关键帧，结果只在当前会话。')
  } catch (cause) { media.notify(cause instanceof Error ? cause.message : String(cause), false) }
  finally { media.busy = false }
}
</script>

<template>
  <SectionCard title="视频巡检" sub="回放 → 三帧取证 → 区域对比 → 小瞳解释，同一个测点">
    <div class="video-toolbar">
      <label>视频素材<select v-model="selection" class="ctl"><option v-for="item in DEMO_VIDEOS" :key="item.key" :value="item.key">{{ item.title }}</option></select></label>
      <AppButton variant="primary" :disabled="!prepared || assistant.busy || media.busy" @click="ask">{{ assistant.busy ? '小瞳正在处理…' : '让小瞳分析这段视频' }}</AppButton>
    </div>
    <VideoEvidence v-if="video" :video="video" :frame-ids="ids" :analysis="media.videoAnalysis" />
    <div v-else class="video-ready">
      <img :src="url(asset.poster)" :alt="asset.title" />
      <div><b>{{ asset.title }}</b><p>{{ asset.note }}</p><p>{{ prepared ? '素材已登记；点击上方按钮，小瞳会按需读取、解码抽帧并计算。' : '请先到系统设置的唯一全链入口准备临时数据；此素材未借给其它测点。' }}</p><a :href="asset.sourceUrl" target="_blank" rel="noopener noreferrer">查看素材来源</a></div>
    </div>
    <details class="local-video"><summary>使用自己的本地视频</summary><input type="file" accept="video/mp4,video/webm" :disabled="media.busy || !pointId" @change="upload" /><AppButton size="sm" :disabled="!video || media.busy" @click="extract">抽三帧</AppButton><p>本地文件机位未经核实，仅播放和抽帧，不默认计算结构变化。</p></details>
  </SectionCard>
</template>

<style scoped>
.video-toolbar { display: flex; align-items: end; gap: 16px; margin-bottom: 16px; }.video-toolbar label { display: grid; gap: 6px; font-size: 12px; color: var(--text-2); min-width: 280px; }.video-ready { display: grid; grid-template-columns: 260px minmax(0,1fr); gap: 22px; padding: 18px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--canvas); }.video-ready img { width: 100%; max-height: 180px; object-fit: contain; border-radius: var(--r-sm); }.video-ready b { font-size: 16px; }.video-ready p,.local-video p { font-size: 12px; line-height: 1.8; color: var(--text-2); }.video-ready a { font-size: 12px; color: var(--brand-700); }.local-video { margin-top: 16px; padding: 12px; font-size: 12px; border-top: 1px solid var(--line); }.local-video summary { cursor: pointer; margin-bottom: 12px; }
</style>

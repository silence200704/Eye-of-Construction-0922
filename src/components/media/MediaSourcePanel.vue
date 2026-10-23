<script setup lang="ts">
/**
 * 影像来源面板：选测点 → 一键载入演示照片 / 人工上传 / 本地视频抽帧。
 *
 * 三处标注不许省：
 * 1. 每张影像都带**来源标签**，生成素材不得冒充现场照片；
 * 2. 面板写清不接校园监控、不调在线服务；
 * 3. 会话影像刷新即失，正式留存走问题附件入口。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatBytes } from '@/db/inspection/attachments'
import { decodeUpload } from '@/core/media/capture'
import { backendActive } from '@/api/backend/runtime'
import { DEMO_PHOTOS, PUBLIC_CRACK_REFERENCE } from '@/config/media/demoPhotos'
import { SESSION_FRAME_LIMIT, useMediaStore } from '@/stores/media'
import { frameOriginLabel, MEDIA_SESSION_NOTE, MEDIA_SESSION_NOTE_SERVER, type MediaFrame } from '@/types/media'
import { formatDateTime } from '@/core/time'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import PreparedEvidencePreview from './PreparedEvidencePreview.vue'

export interface PointOption {
  id: string
  label: string
}

const props = defineProps<{ pointId: string; points: PointOption[] }>()
const emit = defineEmits<{ 'update:pointId': [id: string] }>()

const media = useMediaStore()
const busy = ref(false)
const capturedAt = ref('')
const label = ref('')
const error = ref('')
const urls = ref<Record<string, string>>({})

const frames = computed(() => media.framesOf(props.pointId))
const pointLabel = computed(() => props.points.find((row) => row.id === props.pointId)?.label ?? '')
const sessionNote = computed(() => (backendActive() ? MEDIA_SESSION_NOTE_SERVER : MEDIA_SESSION_NOTE))
const demoReady = computed(() => DEMO_PHOTOS.every((item) => frames.value.some(
  (frame) => frame.origin === 'demo_generated' && frame.fileName === item.fileName,
)))

async function restore(): Promise<void> {
  if (props.pointId === '' || !backendActive()) return
  try {
    await media.restoreRemote(props.pointId)
  } catch (cause) {
    error.value = `服务端影像恢复失败：${cause instanceof Error ? cause.message : String(cause)}`
  }
}

onMounted(restore)
watch(() => props.pointId, restore)

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.slice(1)}`
}

/**
 * 缩略图用对象 URL；建立与释放放在 watch 里（computed 里做副作用会被重复求值）。
 * 只为本测点的影像建 URL，切走时把旧的全部释放。
 */
watch(
  () => frames.value.map((row) => row.id).join(','),
  () => {
    for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
    const next: Record<string, string> = {}
    for (const frame of frames.value) next[frame.id] = URL.createObjectURL(frame.blob)
    urls.value = next
  },
  { immediate: true },
)

onUnmounted(() => {
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
})

async function onPhotos(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length === 0 || props.pointId === '') return
  error.value = ''
  busy.value = true
  let added = 0
  try {
    for (const file of files) {
      const photo = await decodeUpload(file)
      media.addUpload({
        pointId: props.pointId,
        capturedAt: capturedAt.value === '' ? new Date(file.lastModified || Date.now()).toISOString() : new Date(capturedAt.value).toISOString(),
        label: label.value === '' ? file.name : label.value,
        fileName: file.name,
        width: photo.width,
        height: photo.height,
        blob: photo.blob,
      })
      added += 1
    }
    media.notify(backendActive()
      ? `已加入 ${added} 张人工上传影像并提交服务端保存。`
      : `已加入 ${added} 张人工上传的会话影像（本机压缩后暂存，刷新即失）。`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    media.notify(error.value, false)
  } finally {
    busy.value = false
  }
}

async function loadDemo(): Promise<void> {
  await media.loadDemoPair(props.pointId)
}

async function loadPublic(): Promise<void> {
  await media.loadPublicReference(props.pointId)
}

function originTone(origin: MediaFrame['origin']): 'brand' | 'green' | 'gray' {
  if (origin === 'upload') return 'brand'
  if (origin === 'demo_generated') return 'green'
  return 'gray'
}
</script>

<template>
  <SectionCard title="影像素材" sub="照片属于当前测点，前后对照始终绑定同一位置">
    <div class="stack">
      <label class="filter filter--wide">
        <span>关联测点</span>
        <select class="ctl" :value="pointId" @change="emit('update:pointId', ($event.target as HTMLSelectElement).value)">
          <option value="">请选择测点</option>
          <option v-for="point in points" :key="point.id" :value="point.id">{{ point.label }}</option>
        </select>
      </label>

      <p v-if="error !== ''" class="notice notice--warn">{{ error }}</p>
      <p class="notice notice--brand">{{ sessionNote }}</p>

      <PreparedEvidencePreview
        v-if="frames.length === 0"
        :point-id="pointId"
        :point-label="pointLabel"
      />
      <div v-else class="thumbs">
        <figure v-for="frame in frames" :key="frame.id" class="thumb">
          <img :src="urls[frame.id]" :alt="frame.label" />
          <figcaption>
            <StatusTag :tone="originTone(frame.origin)" :text="frameOriginLabel(frame.origin)" :dot="false" />
            <span class="name">{{ frame.label }}</span>
            <span class="muted">{{ frame.origin === 'video_frame' ? '会话读取时间' : frame.origin === 'demo_public' ? '载入时间' : frame.origin === 'demo_generated' || frame.origin === 'demo_evidence' ? '模拟展示时间' : '拍摄时间' }} {{ formatDateTime(frame.capturedAt) }}｜{{ formatBytes(frame.size) }}</span>
            <span v-if="frame.timeCode !== null" class="muted">时间码 {{ frame.timeCode.toFixed(1) }} 秒</span>
            <button class="link" type="button" @click="media.removeFrame(frame.id)">移除</button>
          </figcaption>
        </figure>
      </div>

      <p class="field-hint">
        单个测点最多保留 {{ SESSION_FRAME_LIMIT }} 张会话影像，当前 {{ frames.length }} 张（{{ pointLabel === '' ? '未选择测点' : pointLabel }}）。
        会话影像不参与预警判定：影像差异不会自动生成正式结构预警。
      </p>
      <details class="upload-tools">
        <summary><b>添加其他影像</b><span>演示照片、参考图、人工上传与本地视频</span></summary>
      <div class="grid">
        <div class="box">
          <p class="box-title">一键演示照片</p>
          <div class="demo-pair">
            <button v-for="photo in DEMO_PHOTOS" :key="photo.key" class="demo-thumb" type="button"
              :disabled="media.busy || pointId === ''" :aria-label="`点击载入演示前后照片：${photo.key === 'before' ? '前一张' : '后一张'}`" @click="loadDemo">
              <img :src="assetUrl(photo.path)" :alt="photo.label" />
              <span>{{ photo.key === 'before' ? '前一张' : '后一张' }} · 生成演示图</span>
            </button>
          </div>
          <AppButton size="sm" variant="primary" :disabled="media.busy || pointId === ''" @click="loadDemo">
            {{ media.busy ? '正在载入…' : demoReady ? '演示照片已加入（可重试）' : '一键加入前后照片' }}
          </AppButton>
          <p class="field-hint">点任一照片或上方按钮即可加入这一组同机位生成素材。日期为模拟值，无需文件选择框；{{ backendActive() ? '服务端模式下按来源标记保存到数据库。' : '本地演示模式不写入数据库。' }}</p>
          <div class="public-reference">
            <button class="public-thumb" type="button" :disabled="media.busy || pointId === ''" aria-label="点击加入公开实拍参考图，非本校" @click="loadPublic">
              <img :src="assetUrl(PUBLIC_CRACK_REFERENCE.path)" alt="公开实拍建筑裂缝参考图，非本校" />
            </button>
            <div>
              <p class="field-hint">公开实拍参考图（非本校，不是同机位前后图）</p>
              <AppButton size="sm" :disabled="media.busy || pointId === ''" @click="loadPublic">一键加入参考图</AppButton>
              <p class="field-hint"><a :href="PUBLIC_CRACK_REFERENCE.source" target="_blank" rel="noopener noreferrer">来源与许可</a>：{{ PUBLIC_CRACK_REFERENCE.author }}，{{ PUBLIC_CRACK_REFERENCE.license }}。仅供展示，不参与前后比对。</p>
            </div>
          </div>
        </div>

        <div class="box">
          <p class="box-title">人工上传</p>
          <label class="filter">
            <span>拍摄时间（留空则取文件时间）</span>
            <input v-model="capturedAt" class="ctl" type="datetime-local" />
          </label>
          <label class="filter">
            <span>备注（拍的是什么位置、什么现象）</span>
            <input v-model="label" class="ctl" type="text" placeholder="例如 西墙裂缝下缘" />
          </label>
          <label class="pick">
            <input type="file" accept="image/jpeg,image/png" multiple :disabled="busy || pointId === ''" @change="onPhotos" />
            <span class="pick-btn">{{ busy ? '正在压缩…' : '选择照片（JPG / PNG）' }}</span>
          </label>
          <p class="field-hint">与问题附件同一套压缩口径（每张约 200 KB），方便之后转去留存。</p>
        </div>


      </div>

      </details>
    </div>
  </SectionCard>
</template>

<style scoped>
.stack { display: grid; gap: 16px; }
.upload-tools { border: 1px solid var(--line); border-radius: var(--r-md); padding: 14px 16px; background: var(--canvas); }
.upload-tools summary { cursor: pointer; min-height: 28px; color: var(--text); }
.upload-tools summary span { margin-left: 12px; font-size: 12px; color: var(--text-2); }
.upload-tools[open] .grid { margin-top: 16px; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.box { display: grid; gap: 8px; align-content: start; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--canvas); }
.box-title { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--text-2); }
.demo-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.demo-thumb, .public-thumb { padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
.demo-thumb:disabled, .public-thumb:disabled { cursor: not-allowed; opacity: .7; }
.demo-thumb:focus-visible, .public-thumb:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
.demo-thumb img { display: block; width: 100%; height: 100px; object-fit: cover; border-radius: var(--r-sm); }
.demo-thumb span { display: block; margin-top: 3px; color: var(--text-3); font-size: 11px; }
.public-reference { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; align-items: start; }
.public-reference img { display: block; width: 76px; height: 76px; object-fit: cover; border-radius: var(--r-sm); }
.pick { display: inline-flex; }
.pick input { display: none; }
.pick-btn {
  display: inline-flex; align-items: center; height: var(--h-control); padding: 0 12px;
  border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--paper);
  color: var(--text); font-size: 12.5px; cursor: pointer;
}
.pick-btn:hover { border-color: var(--brand-500); color: var(--brand-700); }
.thumbs { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.thumb { margin: 0; display: grid; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--paper); }
.thumb img { display: block; width: 100%; height: 220px; object-fit: contain; border-radius: var(--r-sm); background: var(--canvas-deep); }
.thumb figcaption { display: grid; gap: 5px; font-size: 12px; }
.name { color: var(--text); overflow-wrap: anywhere; }
.muted { color: var(--text-3); }
.link { justify-self: start; border: 0; background: none; color: var(--brand-700); font: inherit; font-size: 12px; cursor: pointer; min-height: 32px; padding: 0 6px; }
@media (max-width: 600px) { .grid, .thumbs { grid-template-columns: minmax(0, 1fr); } .link { min-height: 44px; } .upload-tools summary span { display: block; margin: 4px 0 0 18px; } }
</style>

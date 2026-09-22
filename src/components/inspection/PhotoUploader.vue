<script setup lang="ts">
/**
 * 照片上传（草稿式）。
 *
 * 评审要求：保存失败时保留草稿并可重试，**不显示虚假的云端上传成功**。
 * 这里只负责"选图 → 压缩 → 交给上层"，真正入库由提交问题/工单时进行：
 * 因此图片先以本地对象 URL 存在草稿里，重试不必重新拍照。
 */
import { computed, ref } from 'vue'
import { ATTACHMENT_LIMITS } from '@/types/inspection'
import { compressPhoto, formatBytes } from '@/db/inspection/attachments'

export interface PhotoDraft {
  id: string
  fileName: string
  /** 压缩后的图，提交时直接入库 */
  blob: Blob
  thumb: Blob
  size: number
  width: number
  height: number
  previewUrl: string
  capturedAt: string | null
}

const props = withDefaults(defineProps<{ photos: PhotoDraft[]; maxCount?: number }>(), {
  maxCount: ATTACHMENT_LIMITS.perIssue,
})
const emit = defineEmits<{ 'update:photos': [photos: PhotoDraft[]]; error: [message: string] }>()

const busy = ref(false)
const error = ref('')

const usedBytes = computed(() => props.photos.reduce((sum, row) => sum + row.size, 0))
const remaining = computed(() => props.maxCount - props.photos.length)

async function onFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length === 0) return
  await addFiles(files)
}

async function addFiles(files: File[]): Promise<void> {
  error.value = ''
  if (props.photos.length + files.length > props.maxCount) {
    error.value = `最多上传 ${props.maxCount} 张；当前已有 ${props.photos.length} 张`
    emit('error', error.value)
    return
  }
  busy.value = true
  const next = [...props.photos]
  try {
    for (const file of files) {
      if (props.maxCount === 1 && usedBytes.value >= ATTACHMENT_LIMITS.totalBytes) break
      const photo = await compressPhoto(file)
      if (usedBytes.value + photo.blob.size > ATTACHMENT_LIMITS.totalBytes) {
        error.value = `单条记录的照片总量不能超过 ${formatBytes(ATTACHMENT_LIMITS.totalBytes)}（已有 ${formatBytes(usedBytes.value)}）`
        break
      }
      next.push({
        id: `draft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        fileName: file.name,
        blob: photo.blob,
        thumb: photo.thumb,
        size: photo.blob.size,
        width: photo.width,
        height: photo.height,
        previewUrl: URL.createObjectURL(photo.thumb),
        capturedAt: file.lastModified === 0 ? null : new Date(file.lastModified).toISOString(),
      })
    }
    emit('update:photos', next)
  } catch (cause) {
    // 失败时草稿保持原样，提示可重试；不写"上传成功"之类的假状态
    error.value = `${(cause as Error).message}（已保留草稿，可重新选择图片重试）`
    emit('error', error.value)
  } finally {
    busy.value = false
  }
}

function remove(index: number): void {
  const row = props.photos[index]
  if (row !== undefined) URL.revokeObjectURL(row.previewUrl)
  emit('update:photos', props.photos.filter((_, i) => i !== index))
}
</script>

<template>
  <div class="uploader">
    <div class="row wrap head">
      <label class="pick">
        <input type="file" accept="image/*" multiple :disabled="busy || remaining <= 0" @change="onFiles" />
        <span class="pick-btn">{{ busy ? '正在压缩…' : '选择照片' }}</span>
      </label>
      <span class="muted">
        已选 {{ photos.length }} / {{ maxCount }} 张，共 {{ formatBytes(usedBytes) }}（上限 {{ formatBytes(ATTACHMENT_LIMITS.totalBytes) }}）
      </span>
    </div>

    <p v-if="error !== ''" class="notice notice--warn">{{ error }}</p>

    <div v-if="photos.length > 0" class="thumbs">
      <figure v-for="(photo, index) in photos" :key="photo.id" class="thumb">
        <img :src="photo.previewUrl" :alt="photo.fileName" />
        <figcaption>
          <span class="name">{{ photo.fileName }}</span>
          <span class="muted">{{ formatBytes(photo.size) }}</span>
          <button class="link" type="button" @click="remove(index)">移除</button>
        </figcaption>
      </figure>
    </div>

    <p class="field-hint">
      照片在本机压缩后保存（每张约 {{ formatBytes(ATTACHMENT_LIMITS.targetBytes) }}），原始大图不入库；
      随备份一并导出。纯前端阶段没有云端上传，"已选"只表示照片在本机草稿里。
    </p>

  </div>
</template>

<style scoped>
.uploader {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head {
  gap: 10px;
  align-items: center;
}

.pick input {
  display: none;
}

.pick-btn {
  display: inline-flex;
  align-items: center;
  height: var(--h-control-sm);
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--paper);
  font-size: 12.5px;
  cursor: pointer;
}

.pick-btn:hover {
  border-color: var(--brand-500);
  color: var(--brand-700);
}

.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
}

.thumb {
  width: 132px;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 4px;
  background: var(--paper);
}

.thumb img {
  width: 100%;
  height: 88px;
  object-fit: cover;
  border-radius: 3px;
  display: block;
}

.thumb figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  margin-top: 4px;
}

.thumb .name {
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link {
  border: 0;
  background: none;
  color: var(--brand-700);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0;
  align-self: flex-start;
}
</style>

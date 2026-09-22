<script setup lang="ts">
/**
 * 巡检问题提交表单。
 *
 * 方案 §3：发现问题可立即提交，**不必先完成整个巡检**；
 * 位置与异常类型带上后，重复提交由提交标识拦截，跨来源疑似重复交给审核人员关联。
 */
import { computed, ref } from 'vue'
import type { ChecklistAnswer, IssueSource } from '@/types/inspection'
import PhotoUploader from '@/components/inspection/PhotoUploader.vue'
import { ANOMALY_TYPES, type PhotoDraftLike } from '@/config/issueOptions'

type PhotoDraft = PhotoDraftLike
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import type { InspectionIssue } from '@/types/inspection'

/**
 * 照片草稿由父组件持有（`defineModel`）。
 * 只放在子组件内部的话，切换点位或关掉表单草稿就没了 ——
 * 而"上传失败要保留草稿可重试"是明确要求。
 */
const photos = defineModel<PhotoDraft[]>('photos', { default: () => [] })

const props = defineProps<{
  pointLabel: string
  zoneLabel: string
  /** 清单里的异常项，自动带入描述，避免重复打字 */
  abnormalItems: ChecklistAnswer[]
  source?: IssueSource
  /** 按异常类型实时算疑似重复候选（跨来源，只提示不合并） */
  candidatesOf?: (anomalyType: string) => InspectionIssue[]
  submitting?: boolean
}>()

const emit = defineEmits<{
  submit: [payload: { anomalyType: string; description: string; photos: PhotoDraft[] }]
  link: [issueId: string]
  cancel: []
}>()

const anomalyType = ref(props.abnormalItems.length > 0 ? '读数异常' : ANOMALY_TYPES[0])
const description = ref(props.abnormalItems.length > 0 ? `检查清单异常：${props.abnormalItems.map((row) => row.label).join('、')}` : '')
const error = ref('')

const canSubmit = computed(() => anomalyType.value.trim() !== '' && description.value.trim().length >= 4 && props.submitting !== true)
const candidates = computed(() => props.candidatesOf?.(anomalyType.value) ?? [])

function submit(): void {
  if (anomalyType.value.trim() === '') {
    error.value = '请选择异常类型'
    return
  }
  if (description.value.trim().length < 4) {
    error.value = '请写明现场情况（至少 4 个字），否则审核无法判断'
    return
  }
  error.value = ''
  emit('submit', { anomalyType: anomalyType.value, description: description.value.trim(), photos: photos.value })
}
</script>

<template>
  <div class="issue-form">
    <dl class="where">
      <div><dt>点位</dt><dd class="mono">{{ pointLabel }}</dd></div>
      <div><dt>位置</dt><dd>{{ zoneLabel }}</dd></div>
      <div><dt>来源</dt><dd>{{ source === 'report' ? '人工上报' : '巡检发现' }}</dd></div>
    </dl>

    <div v-if="candidates !== undefined && candidates.length > 0" class="candidates">
      <p class="notice notice--warn">
        同一位置附近已有 {{ candidates.length }} 条未关闭的同类问题。若是同一件事，请关联已有问题而不是新建：
      </p>
      <ul>
        <li v-for="row in candidates" :key="row.id">
          <span class="mono">{{ row.issueNo }}</span>
          <StatusTag tone="orange" :text="row.anomalyType" />
          <span class="muted">{{ row.description.slice(0, 40) }}</span>
          <button class="link" type="button" @click="emit('link', row.id)">关联这条</button>
        </li>
      </ul>
    </div>

    <label class="field">
      <span>异常类型 <b>*</b></span>
      <select v-model="anomalyType" class="ctl">
        <option v-for="item in ANOMALY_TYPES" :key="item" :value="item">{{ item }}</option>
      </select>
    </label>

    <label class="field">
      <span>现场情况 <b>*</b></span>
      <textarea v-model="description" class="ctl" rows="3" placeholder="例如：探头支架固定螺栓松动，轻碰有位移，读数暂未见异常" />
    </label>

    <div class="field">
      <span>现场照片</span>
      <PhotoUploader v-model:photos="photos" @error="error = $event" />
    </div>

    <p v-if="error !== ''" class="notice notice--warn">{{ error }}</p>

    <div class="row-between foot">
      <AppButton size="sm" @click="emit('cancel')">取消</AppButton>
      <AppButton size="sm" variant="primary" :disabled="!canSubmit" @click="submit">
        提交问题（审核后转维修）
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.issue-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.where {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  font-size: 11.5px;
}

.where dt {
  color: var(--text-3);
}

.where dd {
  margin: 2px 0 0;
  color: var(--text-1);
}

.candidates ul {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.9;
}

.candidates li {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-2);
}

.field b {
  color: var(--state-red, #c0362c);
}

.link {
  border: 0;
  background: none;
  color: var(--brand-700);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.foot {
  border-top: 1px solid var(--line);
  padding-top: 8px;
}
</style>

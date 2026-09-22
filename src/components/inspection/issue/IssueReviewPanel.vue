<script setup lang="ts">
/**
 * 问题审核面板（六个一级出口 + 二级分类）。
 *
 * 从 IssueDetail 抽出来的原因：详情本身已经很长（信息展示 + 工单面板 + 时间线），
 * 审核是另一件事 —— 表单、前置条件、提交防重复、结果预览都自成一套，混在一起没人看得清。
 * 判定与拦截仍在 core/inspection/issueMerge 里，这里只负责收集与呈现。
 */
import { computed, reactive, ref, watch } from 'vue'
import type { InspectionIssue, ReviewAction } from '@/types/inspection'
import { REVIEW_ACTIONS, REVIEW_CATEGORIES } from '@/types/inspection'
import { useIssueStore } from '@/stores/inspection/issues'
import { useEventsStore } from '@/stores/events'
import { useSessionStore } from '@/stores/session'
import { reviewPreview } from '@/core/inspection/reviewPreview'
import type { PhotoDraftLike } from '@/config/issueOptions'
import AppButton from '@/components/ui/AppButton.vue'
import PhotoUploader from '@/components/inspection/PhotoUploader.vue'

const props = defineProps<{ issue: InspectionIssue }>()
const emit = defineEmits<{ changed: [message: string]; dirty: [flag: boolean] }>()

const issues = useIssueStore()
const events = useEventsStore()
const session = useSessionStore()

const reviewOpen = ref(false)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const busy = ref(false)
const photoDrafts = ref<PhotoDraftLike[]>([])
const form = reactive({
  action: 'to_repair' as ReviewAction,
  category: 'equipment',
  note: '',
  duplicateOf: '',
  linkedEventId: '',
  noPhotoReason: '',
})

const categories = computed(() => REVIEW_CATEGORIES[form.action] ?? [])
const openIssues = computed(() => issues.openIssues.filter((row) => row.id !== props.issue.id))
const canReview = computed(() => session.role === 'safety' && props.issue.status !== 'closed')

/**
 * 提交后会发生什么：状态、下一责任人、下一动作、是否自动建工单。
 * 文案与目标状态都取自 core（reviewPreview → nextStatusOf），页面不再自己解释一遍。
 */
const preview = computed(() =>
  reviewPreview({ action: form.action, categoryLabel: categories.value.find((row) => row.key === form.category)?.name ?? '' }),
)

/** 「已当场处理」是唯一一个"处理动作已发生"的关闭理由：要有照片或写明拍不了照的原因。 */
const needHandledEvidence = computed(() => form.action === 'close_no_fault' && form.category === 'handled')

/**
 * 有没有"填了一半、还没提交"的审核内容。
 *
 * 出口与二级分类永远有默认值，不算内容；只有人真的写/选/传了东西才算。
 * 上报给父组件，由它在"切换问题 / Esc / 关闭"三种出口上统一拦一道确认 ——
 * 半填的审核意见被静默丢掉等于白填，用户还会以为已经提交了。
 */
const dirty = computed(
  () =>
    reviewOpen.value &&
    (form.note.trim() !== '' ||
      form.noPhotoReason.trim() !== '' ||
      photoDrafts.value.length > 0 ||
      form.duplicateOf !== '' ||
      form.linkedEventId !== ''),
)

watch(dirty, (value) => emit('dirty', value), { immediate: true })

/**
 * 换出口时清掉不适用的关联字段。
 * 不清的话，上一次选的"关联到某条问题"会被带进"转维修工单"的提交里，
 * 库里就多出一条莫名其妙的关联关系。
 */
watch(
  () => form.action,
  () => {
    form.category = categories.value[0]?.key ?? ''
    form.duplicateOf = ''
    form.linkedEventId = ''
    form.noPhotoReason = ''
    photoDrafts.value = []
  },
)

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    /*
     * 照片不再"先入库再关联"：草稿连同审核结论、工单、审计日志在**同一个事务**里提交。
     * 之前先写附件再提交审核，审核被拒或事务失败就会留下"照片已经在问题上、审核结论没落库"的半成品。
     * 草稿本身就是压缩图，也不需要再过一遍压缩。
     */
    const out = await issues.reviewIssue(props.issue.id, {
      action: form.action,
      category: form.category,
      note: form.note,
      duplicateOf: form.duplicateOf === '' ? null : form.duplicateOf,
      linkedEventId: form.linkedEventId === '' ? null : form.linkedEventId,
      photoDrafts: photoDrafts.value,
      noPhotoReason: form.noPhotoReason,
    })
    tone.value = out.ok ? 'ok' : 'bad'
    message.value = out.ok ? '审核已记录（含时间线与操作日志）' : out.error
    if (out.ok) {
      reviewOpen.value = false
      photoDrafts.value = []
      form.note = ''
      form.noPhotoReason = ''
      emit('changed', message.value)
    }
  } catch (cause) {
    tone.value = 'bad'
    message.value = `提交失败：${(cause as Error).message}（表单内容已保留，可重试）`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="canReview" class="review">
    <div class="row-between">
      <p class="section">审核</p>
      <AppButton size="sm" variant="primary" @click="reviewOpen = !reviewOpen">
        {{ reviewOpen ? '收起' : '审核处理' }}
      </AppButton>
    </div>

    <div v-if="reviewOpen" class="review-form">
      <label class="field">
        <span>处理结果（一级出口）</span>
        <select v-model="form.action" class="ctl">
          <option v-for="item in REVIEW_ACTIONS" :key="item.key" :value="item.key">{{ item.name }}</option>
        </select>
        <em class="field-hint">{{ REVIEW_ACTIONS.find((row) => row.key === form.action)?.hint }}</em>
      </label>

      <label class="field">
        <span>具体情况（二级分类）</span>
        <select v-model="form.category" class="ctl">
          <option v-for="item in categories" :key="item.key" :value="item.key">{{ item.name }}</option>
        </select>
      </label>

      <label v-if="form.action === 'link_object' && form.category === 'issue'" class="field">
        <span>关联到哪条问题 <b>*</b></span>
        <select v-model="form.duplicateOf" class="ctl">
          <option value="">请选择…</option>
          <option v-for="row in openIssues" :key="row.id" :value="row.id">{{ row.issueNo }}｜{{ row.anomalyType }}</option>
        </select>
      </label>

      <label v-if="form.action === 'link_object' && form.category === 'event'" class="field">
        <span>关联到哪次预警 <b>*</b></span>
        <select v-model="form.linkedEventId" class="ctl">
          <option value="">请选择…</option>
          <option v-for="row in events.events" :key="row.id" :value="row.id">{{ row.eventNo }}｜{{ row.level }}</option>
        </select>
      </label>

      <label class="field">
        <span>审核意见 <b>*</b></span>
        <textarea v-model="form.note" class="ctl" rows="3" placeholder="写清楚判断依据与后续安排，会写进时间线与操作日志" />
      </label>

      <!-- 「已当场处理」的证据：照片，或写明为什么拍不了照（二者至少一条，判定在 core 里） -->
      <template v-if="needHandledEvidence">
        <div class="field">
          <span>现场照片</span>
          <PhotoUploader v-model:photos="photoDrafts" @error="message = $event; tone = 'bad'" />
        </div>
        <label class="field">
          <span>无法拍照的原因</span>
          <textarea
            v-model="form.noPhotoReason"
            class="ctl"
            rows="2"
            placeholder="现场没有拍照条件时写明原因（不少于 10 字）；有照片就不用填"
          />
        </label>
      </template>

      <!-- 提交前先说清会发生什么：状态、谁接手、下一步、是否建工单、可不可逆 -->
      <div class="preview" :class="{ 'preview--hard': preview.irreversible }">
        <p class="preview-title">提交后会发生什么</p>
        <ul>
          <li>问题状态 → <b>{{ preview.statusLabel }}</b></li>
          <li>下一责任人：{{ preview.owner }}</li>
          <li>下一步：{{ preview.nextAction }}</li>
          <li v-if="preview.createsWorkOrder">会<b>自动创建维修工单</b>（待派工），单号在本次提交内分配</li>
          <li v-if="preview.affects !== ''">{{ preview.affects }}</li>
          <li v-if="preview.irreversible" class="warn-text">这一步影响待办且不易撤回，请确认结论无误</li>
        </ul>
      </div>

      <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

      <div class="row-between foot">
        <span class="muted">审核动作会同时写入问题时间线与操作日志</span>
        <AppButton size="sm" variant="primary" :disabled="busy" @click="submit">
          {{ busy ? '提交中…' : '提交审核' }}
        </AppButton>
      </div>
    </div>
  </div>
  <p v-else-if="issue.status !== 'closed'" class="muted">审核由学校安全管理人员执行（当前身份：{{ session.roleLabel }}）</p>
</template>

<style scoped>
.review {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.review-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
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

.foot {
  border-top: 1px solid var(--line);
  padding-top: 8px;
}

/* 提交前的结果预览：给的是"会发生什么"，不是又一次确认框 */
.preview {
  border: 1px solid var(--brand-300, #9dc6cd);
  background: var(--bg-2, #f6f8f8);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  font-size: 12px;
}

.preview--hard {
  border-color: var(--state-orange, #b06a00);
  background: #fffaf0;
}

.preview-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.preview ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.8;
}

.warn-text {
  color: var(--state-orange, #b06a00);
}
</style>

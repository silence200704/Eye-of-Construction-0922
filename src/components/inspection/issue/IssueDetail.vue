<script setup lang="ts">
/**
 * 问题详情。
 *
 * 详情要能看到：来源（巡检发现 / 人工上报 / 预警转单）、关联的任务与预警事件、现场照片、
 * 审核记录与完整时间线 —— 三来源进同一个池，但每条都能追回它的原始出处。
 * 审核表单已抽到 IssueReviewPanel（表单、前置条件、结果预览自成一套）；
 * 维修工单面板是 WorkOrderPanel。这里只做信息展示与两个子面板的编排。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { InspectionIssue } from '@/types/inspection'
import { ISSUE_SOURCES, ISSUE_STATUSES } from '@/types/inspection'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { useTaskStore } from '@/stores/inspection/tasks'
import { formatDateTime } from '@/core/time'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import WorkOrderPanel from '@/components/inspection/issue/WorkOrderPanel.vue'
import IssueReviewPanel from '@/components/inspection/issue/IssueReviewPanel.vue'

const props = defineProps<{ issue: InspectionIssue }>()
const emit = defineEmits<{ changed: [message: string]; close: []; reviewDirty: [flag: boolean] }>()

const archive = useArchiveStore()
const events = useEventsStore()
const issues = useIssueStore()
const attachments = useAttachmentStore()
const tasks = useTaskStore()

const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const sourceName = computed(() => ISSUE_SOURCES.find((row) => row.key === props.issue.source)?.name ?? props.issue.source)
const statusName = computed(() => ISSUE_STATUSES.find((row) => row.key === props.issue.status)?.name ?? props.issue.status)
const pointLabel = computed(() => {
  const point = props.issue.pointId === null ? undefined : archive.pointById(props.issue.pointId)
  return point === undefined ? '未指定测点' : `${point.code} ${point.name}`
})
const floorLabel = computed(() => archive.floorById(props.issue.floorId)?.name ?? props.issue.floorId)
/**
 * 照片缩略图：附件存的是 Blob，需要转成对象 URL 才能显示。
 *
 * 对象 URL 的建立与释放放在 watch 里，不在 computed 体内做副作用（computed 会被重复求值）。
 * 另外要容忍**已经损坏的附件行**：早期版本写过库的照片 blob 是 `{}`，
 * 直接对它调 `createObjectURL` 会抛 TypeError 并让整个详情区渲染不出来 ——
 * 这里判成"数据已损坏"给空串，由模板显示占位提示，其余信息照常展示。
 */
const photoRows = computed(() => attachments.ofIssue(props.issue.id))
const thumbUrls = ref<Record<string, string>>({})
const brokenThumbs = ref<string[]>([])

watch(
  () => photoRows.value.map((row) => row.id).join('|'),
  () => {
    const next: Record<string, string> = {}
    const broken: string[] = []
    for (const row of photoRows.value) {
      const existing = thumbUrls.value[row.id]
      if (existing !== undefined) {
        next[row.id] = existing
        continue
      }
      if (row.thumb instanceof Blob) next[row.id] = URL.createObjectURL(row.thumb)
      else broken.push(row.id)
    }
    for (const [id, url] of Object.entries(thumbUrls.value)) {
      if (next[id] === undefined) URL.revokeObjectURL(url)
    }
    thumbUrls.value = next
    brokenThumbs.value = broken
  },
  { immediate: true },
)

const photos = computed(() =>
  photoRows.value.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    size: row.size,
    url: thumbUrls.value[row.id] ?? '',
    broken: brokenThumbs.value.includes(row.id),
  })),
)

onUnmounted(() => {
  for (const url of Object.values(thumbUrls.value)) URL.revokeObjectURL(url)
})
const task = computed(() => (props.issue.taskId === null ? undefined : tasks.byId(props.issue.taskId)))
const eventRow = computed(() => (props.issue.eventId === null ? undefined : events.events.find((row) => row.id === props.issue.eventId)))
const linkedIssue = computed(() => (props.issue.duplicateOf === null ? undefined : issues.byId(props.issue.duplicateOf)))

/** 事件状态的中文名（详情里显示等级、状态与最近证据，而不是只给一个编号） */
function eventStatusName(status: string): string {
  const map: Record<string, string> = {
    pending: '待确认',
    handling: '处理中',
    recovering: '恢复待确认',
    closed: '已关闭',
  }
  return map[status] ?? status
}

</script>

<template>
  <div class="issue-detail">
    <div class="row-between head">
      <div class="title">
        <b>{{ issue.issueNo }}</b>
        <span class="muted">
          {{ sourceName }}｜{{ archive.buildingName(issue.buildingId) }} {{ floorLabel }} {{ issue.zoneId }}｜{{ pointLabel }}
        </span>
      </div>
      <div class="row">
        <StatusTag :tone="issue.status === 'closed' ? 'gray' : issue.status === 'pending_review' ? 'orange' : 'brand'" :text="statusName" />
        <AppButton size="sm" @click="emit('close')">关闭</AppButton>
      </div>
    </div>

    <p class="desc">{{ issue.description }}</p>

    <dl class="meta">
      <div><dt>异常类型</dt><dd>{{ issue.anomalyType }}</dd></div>
      <div><dt>提交人</dt><dd>{{ issue.createdBy }}｜{{ formatDateTime(issue.createdAt) }}</dd></div>
      <div>
        <dt>关联任务</dt>
        <dd>{{ task === undefined ? '—（非巡检来源）' : `${task.taskNo} ${task.planSnapshot.planName}` }}</dd>
      </div>
      <div>
        <dt>关联预警事件</dt>
        <dd v-if="eventRow === undefined">—</dd>
        <dd v-else>
          {{ eventRow.eventNo }}｜{{ eventRow.level }}｜{{ eventStatusName(eventRow.status) }}
          <div class="muted">
            最近证据：{{ eventRow.evidences.length === 0 ? '无' : `${eventRow.evidences[eventRow.evidences.length - 1].recordNo}｜${eventRow.lastTriggerValue}` }}
          </div>
        </dd>
      </div>
      <div><dt>关联原问题</dt><dd>{{ linkedIssue === undefined ? '—' : linkedIssue.issueNo }}</dd></div>
      <div><dt>所属工单</dt><dd>{{ issue.workOrderIds.length === 0 ? '—' : issue.workOrderIds.length + ' 张' }}</dd></div>
    </dl>

    <div v-if="photos.length > 0" class="photos">
      <p class="section">现场照片 {{ photos.length }} 张</p>
      <div class="thumbs">
        <figure v-for="row in photos" :key="row.id" class="thumb">
          <img v-if="row.url !== ''" :src="row.url" :alt="row.fileName" />
          <div v-else class="thumb--broken">照片数据已损坏<br /><span class="muted">请重新上传</span></div>
          <figcaption>{{ row.fileName }}<span class="muted">{{ Math.round(row.size / 1024) }} KB</span></figcaption>
        </figure>
      </div>
    </div>

    <WorkOrderPanel :issue-id="issue.id" @changed="emit('changed', $event)" />

    <div class="timeline">
      <p class="section">审核记录与时间线</p>
      <ul>
        <li v-for="(row, index) in issue.timeline" :key="index">
          <span class="mono">{{ formatDateTime(row.at) }}</span>
          <span>{{ row.by }}（{{ row.byRole }}）</span>
          <b>{{ row.action }}</b>
          <span class="muted">{{ row.detail }}</span>
        </li>
      </ul>
    </div>

    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <IssueReviewPanel :issue="issue" @changed="emit('changed', $event)" @dirty="emit('reviewDirty', $event)" />
  </div>
</template>

<style scoped>
.issue-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  gap: 10px;
  align-items: flex-start;
}

.title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
}

.title .muted,
.muted {
  font-size: 11.5px;
  color: var(--text-3);
}

.desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-1);
  line-height: 1.6;
}

.meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  font-size: 11.5px;
}

.meta dt {
  color: var(--text-3);
}

.meta dd {
  margin: 2px 0 0;
  color: var(--text-1);
}

.section {
  font-size: 12px;
  color: var(--text-2);
  margin: 0 0 6px;
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

.thumb--broken {
  height: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 11px;
  line-height: 1.5;
  color: var(--state-red, #c0362c);
  background: var(--canvas);
  border-radius: 3px;
}

.thumb figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  margin-top: 4px;
}

.timeline ul {
  margin: 0;
  padding-left: 16px;
  font-size: 11.5px;
  line-height: 1.8;
}

.timeline li {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

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
</style>

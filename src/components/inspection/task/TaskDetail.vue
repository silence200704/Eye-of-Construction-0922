<script setup lang="ts">
/**
 * 任务详情：逐点到点打卡、检查清单、问题上报。
 *
 * 显示的范围与归属全部来自任务快照（楼栋、楼层、必查点、执行角色、清单模板），
 * 计划之后被怎么改都不影响这里；任务状态仍由逐点结果推导，页面没有"直接标记完成"。
 */
import { computed, ref } from 'vue'
import type { CheckMethod, ChecklistAnswer, InspectionIssue, InspectionTask } from '@/types/inspection'
import type { PhotoDraft } from '@/components/inspection/PhotoUploader.vue'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { planPhotoSync } from '@/db/inspection/attachments'
import { formatDateTime } from '@/core/time'
import { ROLES } from '@/types/catalog'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import NfcCheckIn from '@/components/inspection/task/NfcCheckIn.vue'
import IssueForm from '@/components/inspection/issue/IssueForm.vue'

const props = defineProps<{ task: InspectionTask }>()
const emit = defineEmits<{ close: [] }>()

const archive = useArchiveStore()
const session = useSessionStore()
const tasks = useTaskStore()
const issues = useIssueStore()
const attachments = useAttachmentStore()

const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const activePointId = ref('')
const issueForPointId = ref('')
const submitting = ref(false)
/** 草稿与"已成功入库"的对应：重试时据此只补缺失的照片 */
const uploadedByDraft = ref<Record<string, string>>({})
const issueDrafts = ref<PhotoDraft[]>([])

const snapshot = computed(() => props.task.planSnapshot)
const progress = computed(() => tasks.progressOf({ ...props.task, results: liveResults.value }))
const liveResults = computed(() => tasks.byId(props.task.id)?.results ?? props.task.results)
const roleName = computed(() => ROLES.find((row) => row.key === snapshot.value.executorRole)?.name ?? snapshot.value.executorRole)
const floorNames = computed(() =>
  snapshot.value.floorIds.map((id) => archive.floorById(id)?.name ?? id).join('、'),
)
const pointLabelOf = (pointId: string): string => {
  const point = archive.pointById(pointId)
  return point === undefined ? pointId : `${point.code} ${point.name}`
}
/** 疑似重复候选按"当前选的异常类型"实时算，避免提示与表单不一致 */
function candidatesOf(anomalyType: string): InspectionIssue[] {
  if (issueForPointId.value === '') return []
  return issues.duplicatesFor({
    pointId: issueForPointId.value,
    buildingId: snapshot.value.buildingId,
    zoneId: archive.pointById(issueForPointId.value)?.zoneId ?? '',
    anomalyType,
    at: new Date().toISOString(),
  })
}

function notify(text: string, ok = true): void {
  tone.value = ok ? 'ok' : 'bad'
  message.value = text
}

/**
 * 三个动作都走仓储的受控入口：页面不能自己拼结果对象。
 * 入口内部校验执行角色、调用纯函数判定、再落库；失败时数据库保持原样。
 */
async function onCheckIn(pointId: string, input: { labelRead: string; method: CheckMethod; fallbackReason: string }): Promise<void> {
  const out = await tasks.attemptCheckIn(props.task.id, pointId, { ...input, at: new Date().toISOString() })
  if (!out.ok) {
    notify(out.error, false)
    return
  }
  const row = out.task?.results.find((item) => item.pointId === pointId)
  const last = row === undefined || row.attempts.length === 0 ? undefined : row.attempts[row.attempts.length - 1]
  notify(last?.message ?? '已记录到点尝试', last?.passed === true)
}

async function onComplete(
  pointId: string,
  payload: { answers: ChecklistAnswer[]; linkedIssueId: string | null; noIssueReason: string },
): Promise<void> {
  const out = await tasks.completePointCheck(props.task.id, pointId, payload)
  notify(out.ok ? '已提交：该点位检查完成（问题按审核与维修流程独立推进）' : out.error, out.ok)
}

/** 上报问题：清单异常项自动带入；可立即提交，不必先完成整个巡检。 */
async function submitIssue(payload: { anomalyType: string; description: string; photos: PhotoDraft[] }): Promise<void> {
  const pointId = issueForPointId.value
  const point = archive.pointById(pointId)
  if (point === undefined) {
    notify('点位档案不存在，无法提交问题', false)
    return
  }
  submitting.value = true
  try {
    /*
     * 问题先建、照片逐张挂：
     * 每存成功一张就立刻同步到问题的 photos —— 中途失败时已成功的照片可见、不会丢；
     * 重试命中同一次提交时复用已有问题（不提前退出），只补还没存上的那几张。
     */
    /*
     * 上报走仓储唯一入口（内部校验执行角色），不再由页面直接建问题。
     * 该点之前关联过问题（上次照片中途失败）时复用那条：补传不该受"同一次提交"10 分钟窗口限制。
     */
    const linkedId = liveResults.value.find((row) => row.pointId === point.id)?.abnormalHandling.linkedIssueId ?? null
    const reused = linkedId === null ? undefined : issues.byId(linkedId)
    const outcome =
      reused === undefined
        ? await tasks.reportInspectionIssue(props.task.id, point.id, {
            anomalyType: payload.anomalyType,
            description: payload.description,
            photos: [],
          })
        : { ok: true, error: '', issue: reused, duplicated: true }
    if (!outcome.ok || outcome.issue === null) {
      notify(outcome.error, false)
      return
    }
    const issue = outcome.issue

    /*
     * 先补关联、再补上传：附件可能已经入库（上次关联失败），
     * 那就只把关联补上，绝不再存一遍 —— 否则会留下两条一模一样的附件。
     */
    const plan = planPhotoSync(payload.photos, attachments.ofIssue(issue.id), photoIdsOfIssue(issue.id))
    for (const item of plan.toLink) {
      const linked = await issues.attachPhotos(issue.id, [item.attachmentId])
      if (linked === null) {
        // 问题在库中找不到（缓存失效等）：算失败，草稿留着让用户重试，不能提示成功
        notify(`照片关联失败：问题 ${issue.issueNo} 已不在本机数据中，请把草稿重新提交（草稿已保留）`, false)
        return
      }
      uploadedByDraft.value = { ...uploadedByDraft.value, [item.draft.id]: item.attachmentId }
    }
    const pending = plan.toUpload
    if (pending.length === 0) {
      notify(
        outcome.duplicated || plan.toLink.length > 0
          ? `问题 ${issue.issueNo}：照片 ${photoIdsOfIssue(issue.id).length} 张已全部关联（补关联 ${plan.toLink.length} 张，未重复上传）`
          : `已提交问题 ${issue.issueNo}（照片 ${payload.photos.length} 张），待安全管理人员审核`,
        true,
      )
      clearDrafts()
      return
    }

    const { uploaded, failure } = await uploadDrafts(issue.id, pending)

    if (failure !== '') {
      notify(
        `问题 ${issue.issueNo} 已建立：照片成功 ${uploaded + plan.toLink.length} 张、失败 ${pending.length - uploaded} 张（${failure}）。已成功的已关联，点「补传照片」只补缺的几张`,
        false,
      )
      return
    }
    notify(`已提交问题 ${issue.issueNo}（照片 ${uploaded + plan.toLink.length} 张），待安全管理人员审核`, true)
    clearDrafts()
  } catch (cause) {
    notify(`提交失败：${(cause as Error).message}（已保留草稿，可重试）`, false)
  } finally {
    submitting.value = false
  }
}

/**
 * 逐张上传并按张同步关联。
 * 每成功一张就写进 uploadedByDraft 并挂到问题上：中途失败时已成功的照片可见，
 * 重试只补缺失的那几张，不会因为一次失败把整批照片丢掉。
 */
async function uploadDrafts(issueId: string, drafts: PhotoDraft[]): Promise<{ uploaded: number; failure: string }> {
  let uploaded = 0
  for (const draft of drafts) {
    try {
      const saved = await attachments.add({
        file: new File([draft.blob], draft.fileName, { type: 'image/jpeg' }),
        kind: 'scene',
        issueId,
        workOrderId: null,
        actor: session.name,
        capturedAt: draft.capturedAt,
        draftId: draft.id,
      })
      const linked = await issues.attachPhotos(issueId, [saved.id])
      if (linked === null) {
        // 附件已入库但关联失败：如实报错，重试时会走"补关联"而不是再传一遍
        return { uploaded, failure: `附件已保存但关联到问题失败（问题 ${issueId} 不在本机数据中）` }
      }
      uploadedByDraft.value = { ...uploadedByDraft.value, [draft.id]: saved.id }
      uploaded += 1
    } catch (cause) {
      return { uploaded, failure: (cause as Error).message }
    }
  }
  return { uploaded, failure: '' }
}

function photoIdsOfIssue(issueId: string): string[] {
  return issues.byId(issueId)?.photos ?? []
}

function clearDrafts(): void {
  issueDrafts.value = []
  uploadedByDraft.value = {}
  issueForPointId.value = ''
}

function onLinkExisting(issueId: string): void {
  const target = issues.byId(issueId)
  if (target === undefined) return
  notify(`已选择关联 ${target.issueNo}；在问题池用「重复问题关联原记录」完成关联并保留两次发现的记录`, true)
  issueForPointId.value = ''
}

/** 该点已关联问题的编号（面板上显示用） */
function linkedIssueLabel(result: { abnormalHandling: { linkedIssueId: string | null } }): string {
  const id = result.abnormalHandling.linkedIssueId
  if (id === null) return ''
  return issues.byId(id)?.issueNo ?? id
}

/** 当前身份能否操作本任务：只有执行角色可以到点与提交（仓储还会再校验一次） */
const canOperate = computed(() => session.role === snapshot.value.executorRole)

const abnormalOf = (pointId: string): ChecklistAnswer[] => {
  const row = liveResults.value.find((item) => item.pointId === pointId)
  return (row?.checklist ?? []).filter((item) => item.result === 'abnormal')
}
</script>

<template>
  <div class="detail">
    <div class="row-between head">
      <div class="title">
        <b>{{ snapshot.planName }}</b>
        <span class="muted">
          {{ task.taskNo }}｜{{ archive.buildingName(snapshot.buildingId) }} {{ floorNames }}｜
          {{ roleName }}｜计划时刻 {{ formatDateTime(task.plannedAt) }}
        </span>
      </div>
      <div class="row">
        <StatusTag :tone="progress.overdue ? 'red' : task.status === 'checked' ? 'green' : 'orange'" :text="progress.overdue ? '逾期未检' : task.status === 'checked' ? '已检查' : '进行中'" />
        <AppButton size="sm" @click="emit('close')">关闭</AppButton>
      </div>
    </div>

    <p class="muted">
      到点进度 {{ progress.completed }} / {{ progress.total }}｜检查项 {{ snapshot.checklist.length }} 项｜
      任务范围与执行角色取自生成时的计划快照，计划后续调整不影响本任务
    </p>

    <p v-if="!canOperate" class="notice notice--warn">
      当前身份是「{{ session.roleLabel }}」，不能操作该任务：执行角色是「{{ roleName }}」。
      请到「系统设置」切换身份后再到点检查 —— 仓储入口会校验执行角色，页面改不了这一点。
    </p>

    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <div class="points">
      <div v-for="result in liveResults" :key="result.pointId" class="point-block">
        <div class="row-between point-head">
          <span class="mono">{{ pointLabelOf(result.pointId) }}</span>
          <AppButton
            size="sm"
            :variant="activePointId === result.pointId ? 'default' : 'primary'"
            @click="activePointId = activePointId === result.pointId ? '' : result.pointId"
          >
            {{ activePointId === result.pointId ? '收起' : '到点检查' }}
          </AppButton>
        </div>

        <NfcCheckIn
          v-if="activePointId === result.pointId"
          :point="archive.pointById(result.pointId)"
          :result="result"
          :issue-label="linkedIssueLabel(result)"
          :saving="submitting"
          @check-in="onCheckIn(result.pointId, $event)"
          @complete="onComplete(result.pointId, $event)"
          @request-issue="issueForPointId = result.pointId"
        />
      </div>
    </div>

    <div v-if="issueForPointId !== ''" class="issue-block">
      <p class="section-title">上报问题</p>
      <IssueForm
        v-model:photos="issueDrafts"
        :point-label="pointLabelOf(issueForPointId)"
        :zone-label="archive.pointById(issueForPointId)?.zoneId ?? ''"
        :abnormal-items="abnormalOf(issueForPointId)"
        :candidates-of="candidatesOf"
        :submitting="submitting"
        @submit="submitIssue"
        @link="onLinkExisting"
        @cancel="issueForPointId = ''"
      />
    </div>
  </div>
</template>

<style scoped>
.detail {
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

.title .muted {
  font-size: 11.5px;
  color: var(--text-3);
}

.points {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.point-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--bg-2, #f6f8f8);
}

.point-head {
  gap: 8px;
  align-items: center;
  font-size: 12.5px;
}

.issue-block {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.section-title {
  font-size: 12.5px;
  color: var(--text-2);
  margin: 0 0 8px;
}
</style>

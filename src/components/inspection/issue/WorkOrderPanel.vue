<script setup lang="ts">
/**
 * 维修工单面板（挂在问题详情里）。
 *
 * 状态流转一律走仓储的 advanceOrder()（内部调 core 的 advance() 判定角色与前置条件），
 * 页面只负责收集必要信息：派工选人、接单填期限、完工填措施材料与照片、验收写意见。
 * 关键口径：**验收通过只把问题推进到"待复查"，不自动关闭**。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { WorkOrder, WorkOrderStatus } from '@/types/inspection'
import { backendActive } from '@/api/backend/runtime'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useBackendSessionStore } from '@/stores/backend/session'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { isAssignedTo } from '@/core/inspection/workOrderFlow'
import { formatDateTime } from '@/core/time'
import { planPhotoSync } from '@/db/inspection/attachments'
import type { PhotoDraftLike } from '@/config/issueOptions'
import { DEMO_PEOPLE } from '@/config/people'
import { ROLES } from '@/types/catalog'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import PhotoUploader from '@/components/inspection/PhotoUploader.vue'

/** focusOrderId：深链指定的那张工单，加一圈高亮表示"就是这条"（滚动定位在 IssueDetail 做） */
const props = defineProps<{ issueId: string; focusOrderId?: string }>()
const emit = defineEmits<{ changed: [message: string] }>()

const archive = useArchiveStore()
const session = useSessionStore()
const backend = useBackendSessionStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()

const note = ref('')
const assignee = ref('')
const dueAt = ref('')
const measures = ref('')
const materials = ref('')
const photos = ref<PhotoDraftLike[]>([])
const acceptancePhotos = ref<PhotoDraftLike[]>([])
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const busy = ref(false)
/** 大图预览：点缩略图看原图（照片存在库里，界面只显示张数的话等于看不到留痕） */
const zoom = ref<{ url: string; fileName: string } | null>(null)
const urlMap = ref<Record<string, { thumb: string; full: string }>>({})

/**
 * 工单照片的缩略图：`order.photos` 存的是附件 ID，这里按 ID 取回并建立对象 URL。
 * 建立与释放都放在 watch 里（computed 里做副作用会被重复求值），损坏的附件行不给 URL、显示占位。
 */
watch(
  () => `${workOrders.orders.map((row) => row.photos.join(',')).join('|')}|${attachments.attachments.map((row) => `${row.id}:${row.workOrderId}:${row.kind}`).join('|')}`,
  () => {
    const next: Record<string, { thumb: string; full: string }> = {}
    for (const order of workOrders.orders) {
      for (const id of evidenceIds(order)) {
        const existing = urlMap.value[id]
        if (existing !== undefined) {
          next[id] = existing
          continue
        }
        const row = attachments.attachments.find((item) => item.id === id)
        if (row !== undefined && row.thumb instanceof Blob && row.blob instanceof Blob) {
          next[id] = { thumb: URL.createObjectURL(row.thumb), full: URL.createObjectURL(row.blob) }
        }
      }
    }
    for (const [id, entry] of Object.entries(urlMap.value)) {
      if (next[id] === undefined) {
        URL.revokeObjectURL(entry.thumb)
        URL.revokeObjectURL(entry.full)
      }
    }
    urlMap.value = next
  },
  { immediate: true },
)

onUnmounted(() => {
  for (const entry of Object.values(urlMap.value)) {
    URL.revokeObjectURL(entry.thumb)
    URL.revokeObjectURL(entry.full)
  }
})

/** 某张工单照片的缩略图地址；坏行返回空串，由模板显示占位。 */
function thumbOf(id: string): string {
  return urlMap.value[id]?.thumb ?? ''
}

const orders = computed(() => workOrders.ordersOfIssue(props.issueId))
const repairRoles = ROLES.filter((row) => row.key === 'repair' || row.key === 'property')
const serverWorkers = computed(() =>
  backend.identities.filter((row) => row.role === 'repair' || row.role === 'property'),
)

const STATUS_TEXT: Record<WorkOrderStatus, string> = {
  created: '待派工',
  assigned: '已派工待接单',
  repairing: '处理中',
  submitted: '待验收',
  verified: '验收通过',
  returned: '验收退回',
}

function toneOf(status: WorkOrderStatus): 'gray' | 'orange' | 'brand' | 'green' | 'red' {
  if (status === 'created') return 'orange'
  if (status === 'verified') return 'green'
  if (status === 'returned') return 'red'
  if (status === 'submitted') return 'brand'
  return 'gray'
}

/** 当前身份能做什么：派工限安全管理人员，其余由仓储判定角色，这里只是提示与取参 */
function canAssign(): boolean {
  return session.role === 'safety'
}

function canWork(): boolean {
  return session.role === 'repair' || session.role === 'property'
}

function canVerify(): boolean {
  return session.role === 'safety'
}

/** 当前身份是否就是被派工的人：服务端按身份 ID，本地演示按仓储同名口径 */
function assignedToMe(order: WorkOrder): boolean {
  if (backendActive()) return order.assigneeId !== undefined && order.assigneeId === backend.user?.id
  return isAssignedTo(order, { roleKey: session.role, name: session.name })
}

function dispatchExtra(): Parameters<typeof workOrders.advanceOrder>[2] {
  const due = dueAt.value === '' ? null : dueAt.value
  return backendActive()
    ? { assigneeId: assignee.value, dueAt: due }
    : { assignee: assignee.value, dueAt: due }
}

async function run(order: WorkOrder, to: WorkOrderStatus, extra: Parameters<typeof workOrders.advanceOrder>[2] = {}): Promise<void> {
  busy.value = true
  const payload = { note: note.value.trim(), ...extra }
  if (to === 'submitted' && photos.value.length > 0) {
    if (backendActive()) {
      // 服务端模式：照片草稿随完工命令一起上传与关联，重试由草稿标识去重。
      payload.photoDrafts = photos.value
    } else {
      /*
       * 先认人再上传：附件入库时就带了工单归属与草稿标识。上一次提交若被拦下
       * （措施没填、事务失败），照片其实已经在库里，直接重传会在工单下堆出重复照片。
       * 因此先查库、只上传缺的那几张，其余补关联。查库而不是查缓存：缓存可能已过期。
       */
      const plan = planPhotoSync(photos.value, await attachments.existingOfOrder(order.id), order.photos)
      const ids = plan.toLink.map((row) => row.attachmentId)
      for (const draft of plan.toUpload) {
        const saved = await attachments.add({
          file: new File([draft.blob], draft.fileName, { type: 'image/jpeg' }),
          kind: 'after',
          issueId: null,
          workOrderId: order.id,
          actor: session.name,
          capturedAt: draft.capturedAt,
          draftId: draft.id,
        })
        ids.push(saved.id)
      }
      payload.photos = ids
    }
  }
  if ((to === 'verified' || to === 'returned') && acceptancePhotos.value.length > 0) payload.acceptancePhotos = acceptancePhotos.value
  const out = await workOrders.advanceOrder(order.id, to, payload)
  busy.value = false
  tone.value = out.ok ? 'ok' : 'bad'
  message.value = out.ok ? `工单 ${order.orderNo} 已流转到「${STATUS_TEXT[to]}」` : out.error
  if (out.ok) {
    // 验收通过时问题已随工单在同一事务里进入"待复查"，这里不再单独写问题状态
    photos.value = []
    acceptancePhotos.value = []
    note.value = ''
    assignee.value = ''
    dueAt.value = ''
    materials.value = ''
    emit('changed', message.value)
  }
}

function photoCount(order: WorkOrder): number {
  return order.photos.length
}

function acceptancePhotoIds(order: WorkOrder): string[] {
  return attachments.ofOrder(order.id).filter((row) => row.kind === 'acceptance').map((row) => row.id)
}

function evidenceIds(order: WorkOrder): string[] {
  return [...new Set([...order.photos, ...acceptancePhotoIds(order)])]
}

function pointLabel(order: WorkOrder): string {
  if (order.pointId === null) return '未指定测点'
  const point = archive.pointById(order.pointId)
  return point === undefined ? order.pointId : `${point.code} ${point.name}`
}

/**
 * 工单四步：面板原来按状态一块一块冒出来，演示时看不出"这是个流程、我在第几步"。
 * 只在界面上把步骤讲明白，状态机与判定一律不动。
 */
const WORK_ORDER_STEPS = ['派工', '接单维修', '提交维修报告', '验收']

/** 当前处在第几步（0 起）；`verified` 已完成四步，返回步数本身。 */
function stepIndexOf(status: string): number {
  switch (status) {
    case 'created':
      return 0
    case 'assigned':
    case 'repairing':
    case 'returned':
      return 1
    case 'submitted':
      return 2
    case 'verified':
      return WORK_ORDER_STEPS.length
    default:
      return 0
  }
}

/** 审查轮次：退回返工再验收会累积多条，这里把"审了几次、退回几次"摆出来。 */
function reviewSummary(order: WorkOrder): string {
  const total = order.reviews.length
  if (total === 0) return order.status === 'submitted' ? '本次为第 1 次送审' : ''
  const returned = order.reviews.filter((row) => row.action === 'return').length
  const extra = order.status === 'submitted' ? '；本次为新一轮送审' : ''
  return `已审查 ${total} 次（退回 ${returned} 次）${extra}`
}

/** 人员标签：名单里有的名字已经带了职责（如"李老师（后勤保障处）"），不要再追加一次。 */
function personLabel(person: { name: string; duty: string }): string {
  return person.name.includes(person.duty) ? person.name : `${person.name}（${person.duty}）`
}
</script>

<template>
  <div class="wo-panel">
    <p class="section">维修工单</p>

    <p v-if="orders.length === 0" class="muted">
      尚未创建工单。审核选择「转维修工单」时会自动生成一张"待派工"的工单。
    </p>

    <div
      v-for="order in orders"
      :key="order.id"
      class="order"
      :class="{ 'order--focus': order.id === props.focusOrderId }"
    >
      <div class="row-between head">
        <div class="title">
          <b class="mono">{{ order.orderNo }}</b>
          <span class="muted">{{ order.title }}｜{{ pointLabel(order) }}｜来源：{{ order.origin === 'issue' ? '人工问题转单' : order.origin === 'event' ? '预警转单' : '手工建单' }}</span>
        </div>
        <StatusTag :tone="toneOf(order.status)" :text="STATUS_TEXT[order.status]" />
      </div>

      <p class="muted steps-line">
        流程：<template v-for="(step, index) in WORK_ORDER_STEPS" :key="step">
          <b v-if="stepIndexOf(order.status) === index">{{ index + 1 }}. {{ step }}（当前）</b>
          <template v-else>{{ index + 1 }}. {{ step }}</template>
          <template v-if="index < WORK_ORDER_STEPS.length - 1"> → </template>
        </template>
      </p>
      <p v-if="reviewSummary(order) !== ''" class="muted">{{ reviewSummary(order) }}</p>

      <dl class="meta">
        <div><dt>维修人</dt><dd>{{ order.assignee === '' ? '待派工' : order.assignee }}</dd></div>
        <div><dt>期限</dt><dd class="mono">{{ order.dueAt === null ? '—' : formatDateTime(order.dueAt) }}</dd></div>
        <div>
          <dt>完工照片</dt>
          <dd class="num">
            {{ photoCount(order) }} 张<template v-if="order.photos.length > 0">（点开可看）</template>
          </dd>
        </div>
        <div><dt>验收照片</dt><dd class="num">{{ acceptancePhotoIds(order).length }} 张</dd></div>
        <div><dt>提交待验收</dt><dd class="mono">{{ order.submittedAt === null ? '—' : formatDateTime(order.submittedAt) }}</dd></div>
      </dl>

      <p v-if="order.measures !== ''" class="measures">维修措施：{{ order.measures }}</p>

      <div v-if="evidenceIds(order).length > 0" class="order-photos">
        <button v-for="id in evidenceIds(order)" :key="id" type="button" class="thumb-btn" @click="zoom = urlMap[id] === undefined ? null : { url: urlMap[id].full, fileName: id }">
          <img v-if="thumbOf(id) !== ''" :src="thumbOf(id)" :alt="`工单照片 ${id}`" />
          <span v-else class="thumb-broken">照片数据已损坏</span>
        </button>
        <span class="muted">工单现场与验收照片（压缩图，原始大图不入库）</span>
      </div>

      <AppModal :open="zoom !== null" :title="zoom?.fileName ?? '工单照片'" sub="工单留痕照片" :width="720" @close="zoom = null">
        <img v-if="zoom !== null" class="zoom" :src="zoom.url" alt="工单照片" />
      </AppModal>

      <div v-if="canAssign() && order.status === 'created'" class="row wrap actions">
        <select v-if="backendActive()" v-model="assignee" class="ctl">
          <option value="">选择维修人…</option>
          <option v-for="person in serverWorkers" :key="person.id" :value="person.id">
            {{ person.name }}（{{ person.roleLabel }}）
          </option>
        </select>
        <select v-else v-model="assignee" class="ctl">
          <option value="">选择维修人…</option>
          <optgroup label="按角色指派">
            <option v-for="role in repairRoles" :key="role.key" :value="role.name">{{ role.name }}</option>
          </optgroup>
          <optgroup label="按人指派（该人需具备维修 / 物业角色才能接单）">
            <option v-for="person in DEMO_PEOPLE" :key="person.name" :value="person.name">
              {{ personLabel(person) }}
            </option>
          </optgroup>
        </select>
        <input v-model="dueAt" class="ctl" type="date" />
        <input v-model="note" class="ctl grow" placeholder="派工说明（写清楚现场情况与要求）" />
        <AppButton size="sm" variant="primary" :disabled="busy || assignee === ''" @click="run(order, 'assigned', dispatchExtra())">
          派工
        </AppButton>
      </div>

      <div v-else-if="canWork() && (order.status === 'assigned' || order.status === 'returned')" class="col actions">
        <p class="muted">
          本工单派给：<b>{{ order.assignee }}</b>
          <template v-if="assignedToMe(order)">｜当前身份与该指派一致，可接单</template>
          <template v-else-if="session.role === 'property'">｜当前身份不是被派工人：物业值班可代接，必须写明代接原因</template>
          <template v-else>｜当前身份不是被派工人：本工单只能由被派工人接单，或由物业值班写明代接原因后代接</template>
        </p>
        <div class="row-between">
          <input
            v-model="note"
            class="ctl grow"
            :placeholder="assignedToMe(order) ? '接单说明（到场时间、初步判断）' : '代接原因（必填：原维修人是谁、为何代接）'"
          />
          <AppButton size="sm" variant="primary" :disabled="busy" @click="run(order, 'repairing')">接单处理</AppButton>
        </div>
      </div>

      <div v-else-if="canWork() && order.status === 'repairing'" class="col actions">
        <p><b>维修报告（措施 / 材料 / 完工照片）</b>：提交后进入待验收，由安全管理人员审查</p>
        <input v-model="measures" class="ctl" placeholder="维修措施（必填，例如 重新固定支架并加固螺栓）" />
        <input v-model="materials" class="ctl" placeholder="使用材料（选填）" />
        <PhotoUploader v-model:photos="photos" @error="message = $event; tone = 'bad'" />
        <div class="row-between">
          <input v-model="note" class="ctl grow" placeholder="提交说明（选填）" />
          <AppButton size="sm" variant="primary" :disabled="busy || measures.trim() === ''" @click="run(order, 'submitted', { measures, materials })">
            提交待验收
          </AppButton>
        </div>
      </div>

      <div v-else-if="canVerify() && order.status === 'submitted'" class="col actions">
        <input v-model="note" class="ctl grow" placeholder="验收意见（退回必填，说明哪里不合格）" />
        <PhotoUploader v-model:photos="acceptancePhotos" @error="message = $event; tone = 'bad'" />
        <p class="muted">验收照片随验收结论一并提交；未选照片也可记录文字验收结论。</p>
        <div class="row wrap">
        <AppButton size="sm" :disabled="busy" @click="run(order, 'returned')">验收退回</AppButton>
        <AppButton size="sm" variant="primary" :disabled="busy" @click="run(order, 'verified')">验收通过</AppButton>
        </div>
      </div>

      <p v-else class="muted">
        {{ order.status === 'verified' ? '验收已通过：问题进入待复查，不自动关闭；事件关闭还需要连续 3 条恢复复测与处置依据。' : '当前身份在该状态下没有可执行动作。' }}
      </p>

      <details v-if="order.timeline.length > 0" class="timeline">
        <summary>工单时间线（{{ order.timeline.length }} 条）</summary>
        <ul>
          <li v-for="(row, index) in order.timeline" :key="index">
            <span class="mono">{{ formatDateTime(row.at) }}</span>
            <span>{{ row.by }}（{{ row.byRole }}）</span>
            <b>{{ row.action }}</b>
            <span class="muted">{{ row.detail }}</span>
          </li>
        </ul>
      </details>

      <details v-if="order.reviews.length > 0" class="timeline">
        <summary>验收记录（{{ order.reviews.length }} 条）</summary>
        <ul>
          <li v-for="(row, index) in order.reviews" :key="index">
            <span class="mono">{{ formatDateTime(row.at) }}</span>
            <span>{{ row.by }}（{{ row.byRole }}）</span>
            <b>{{ row.result === 'pass' ? '验收通过' : '验收退回' }}</b>
            <span class="muted">{{ row.note }}</span>
          </li>
        </ul>
      </details>
    </div>

    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>
  </div>
</template>

<style scoped src="./styles/WorkOrderPanel.css"></style>

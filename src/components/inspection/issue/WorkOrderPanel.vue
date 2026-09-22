<script setup lang="ts">
/**
 * 维修工单面板（挂在问题详情里）。
 *
 * 状态流转一律走仓储的 advanceOrder()（内部调 core 的 advance() 判定角色与前置条件），
 * 页面只负责收集必要信息：派工选人、接单填期限、完工填措施材料与照片、验收写意见。
 * 关键口径：**验收通过只把问题推进到"待复查"，不自动关闭**。
 */
import { computed, ref } from 'vue'
import type { WorkOrder, WorkOrderStatus } from '@/types/inspection'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { isAssignedTo } from '@/core/inspection/workOrderFlow'
import { formatDateTime } from '@/core/time'
import { planPhotoSync } from '@/db/inspection/attachments'
import type { PhotoDraftLike } from '@/config/issueOptions'
import { ROLES } from '@/types/catalog'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import PhotoUploader from '@/components/inspection/PhotoUploader.vue'

const props = defineProps<{ issueId: string }>()
const emit = defineEmits<{ changed: [message: string] }>()

const archive = useArchiveStore()
const session = useSessionStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()

const note = ref('')
const assignee = ref('')
const dueAt = ref('')
const measures = ref('')
const materials = ref('')
const photos = ref<PhotoDraftLike[]>([])
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const busy = ref(false)

const orders = computed(() => workOrders.ordersOfIssue(props.issueId))
const repairRoles = ROLES.filter((row) => row.key === 'repair' || row.key === 'property')

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

/** 当前身份是否就是被派工的人（与仓储判定同一口径） */
function assignedToMe(order: WorkOrder): boolean {
  return isAssignedTo(order, { roleKey: session.role, name: session.name })
}

async function run(order: WorkOrder, to: WorkOrderStatus, extra: Parameters<typeof workOrders.advanceOrder>[2] = {}): Promise<void> {
  busy.value = true
  const payload = { note: note.value.trim(), ...extra }
  if (to === 'submitted' && photos.value.length > 0) {
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
  const out = await workOrders.advanceOrder(order.id, to, payload)
  busy.value = false
  tone.value = out.ok ? 'ok' : 'bad'
  message.value = out.ok ? `工单 ${order.orderNo} 已流转到「${STATUS_TEXT[to]}」` : out.error
  if (out.ok) {
    // 验收通过时问题已随工单在同一事务里进入"待复查"，这里不再单独写问题状态
    photos.value = []
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

function pointLabel(order: WorkOrder): string {
  if (order.pointId === null) return '未指定测点'
  const point = archive.pointById(order.pointId)
  return point === undefined ? order.pointId : `${point.code} ${point.name}`
}
</script>

<template>
  <div class="wo-panel">
    <p class="section">维修工单</p>

    <p v-if="orders.length === 0" class="muted">
      尚未创建工单。审核选择「转维修工单」时会自动生成一张"待派工"的工单。
    </p>

    <div v-for="order in orders" :key="order.id" class="order">
      <div class="row-between head">
        <div class="title">
          <b class="mono">{{ order.orderNo }}</b>
          <span class="muted">{{ order.title }}｜{{ pointLabel(order) }}｜来源：{{ order.origin === 'issue' ? '人工问题转单' : order.origin === 'event' ? '预警转单' : '手工建单' }}</span>
        </div>
        <StatusTag :tone="toneOf(order.status)" :text="STATUS_TEXT[order.status]" />
      </div>

      <dl class="meta">
        <div><dt>维修人</dt><dd>{{ order.assignee === '' ? '待派工' : order.assignee }}</dd></div>
        <div><dt>期限</dt><dd class="mono">{{ order.dueAt === null ? '—' : formatDateTime(order.dueAt) }}</dd></div>
        <div><dt>完工照片</dt><dd class="num">{{ photoCount(order) }} 张</dd></div>
        <div><dt>提交待验收</dt><dd class="mono">{{ order.submittedAt === null ? '—' : formatDateTime(order.submittedAt) }}</dd></div>
      </dl>

      <p v-if="order.measures !== ''" class="measures">维修措施：{{ order.measures }}</p>

      <div v-if="canAssign() && order.status === 'created'" class="row wrap actions">
        <select v-model="assignee" class="ctl">
          <option value="">选择维修人…</option>
          <option v-for="role in repairRoles" :key="role.key" :value="role.name">{{ role.name }}</option>
        </select>
        <input v-model="dueAt" class="ctl" type="date" />
        <input v-model="note" class="ctl grow" placeholder="派工说明（写清楚现场情况与要求）" />
        <AppButton size="sm" variant="primary" :disabled="busy || assignee === ''" @click="run(order, 'assigned', { assignee, dueAt: dueAt === '' ? null : dueAt })">
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

      <div v-else-if="canVerify() && order.status === 'submitted'" class="row wrap actions">
        <input v-model="note" class="ctl grow" placeholder="验收意见（退回必填，说明哪里不合格）" />
        <AppButton size="sm" :disabled="busy" @click="run(order, 'returned')">验收退回</AppButton>
        <AppButton size="sm" variant="primary" :disabled="busy" @click="run(order, 'verified')">验收通过</AppButton>
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

<style scoped>
.wo-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.section {
  font-size: 12px;
  color: var(--text-2);
  margin: 0;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}

.order {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--bg-2, #f6f8f8);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head {
  gap: 8px;
  align-items: flex-start;
}

.title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12.5px;
}

.meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.measures {
  margin: 0;
  font-size: 12px;
  color: var(--text-1);
}

.actions {
  gap: 8px;
  align-items: center;
}

.actions.col {
  flex-direction: column;
  align-items: stretch;
}

.grow {
  flex: 1;
  min-width: 200px;
}

.timeline ul {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 11.5px;
  line-height: 1.8;
}

.timeline li {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>

<script setup lang="ts">
/**
 * 预警事件详情：判定快照、证据链、升级历史、时间线、通知与确认。
 * 关闭事件必须填写关闭依据，数据恢复不自动关闭。
 */
import { computed, ref, watch } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useSessionStore } from '@/stores/session'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { EVENT_LEVEL_LABEL, EVENT_STATUS_LABEL, type EventLevel, type EventStatus } from '@/types/events'
import { closeGuard } from '@/core/event/plan'
import { fmtNumber } from '@/core/format'
import { formatDateTime } from '@/core/time'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import DataTable from '@/components/ui/DataTable.vue'
import FormGrid from '@/components/ui/FormGrid.vue'
import EventIssueForm from '@/components/inspection/issue/EventIssueForm.vue'

const props = defineProps<{ open: boolean; eventId: string }>()
const emit = defineEmits<{ close: [] }>()

const archive = useArchiveStore()
const events = useEventsStore()
const issues = useIssueStore()
const session = useSessionStore()
const workOrders = useWorkOrderStore()

const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')
const closeOpen = ref(false)
const transferOpen = ref(false)
const closeModel = ref<Record<string, unknown>>({ basis: '', noRepairNote: '' })
const closeFields = [
  {
    key: 'basis',
    label: '关闭依据（复查结论）',
    type: 'textarea' as const,
    required: true,
    rows: 2,
    placeholder: '例如 连续三次复测均低于恢复阈值，现场复查无新增裂缝，经安全管理人员确认关闭',
  },
  {
    key: 'noRepairNote',
    label: '无需维修核查结论',
    type: 'textarea' as const,
    rows: 2,
    placeholder: '仅当没有关联工单时填写：现场核查确认无需维修的理由（不少于 10 字）',
    hint: '有关联工单且已验收通过时不用填；两者至少要成立一条，否则不能关闭',
  },
]

const event = computed(() => events.byId(props.eventId))
const point = computed(() => (event.value === undefined ? undefined : archive.pointById(event.value.pointId)))
const notifications = computed(() => (event.value === undefined ? [] : events.notificationsOf(event.value.id)))
const openRelatedIssues = computed(() =>
  event.value === undefined ? [] : issues.issues.filter((row) => row.eventId === event.value?.id && row.status !== 'closed'),
)
const canAcknowledge = computed(() => event.value?.status === 'pending')
/** 预警转问题只允许安全管理人员发起；关闭事件后不再新建处置问题。 */
const canTransfer = computed(() => session.role === 'safety' && event.value !== undefined && event.value.status !== 'closed')
/** 关闭权限与时机：只有安全管理人员、且事件已进入恢复待确认时才可关闭。 */
const closePermission = computed(() =>
  event.value === undefined ? { allowed: false, reason: '' } : closeGuard(event.value.status, session.role),
)
const canClose = computed(() => closePermission.value.allowed)

/**
 * 处置依据的实时提示：关联工单已验收通过，或安全管理人员写了"无需维修"核查结论。
 * 这里读的是内存快照（用于随输入即时反馈）；**真正决定能不能关的那次判定在仓储里读库复核**。
 */
const closeBasisCheck = computed(() =>
  workOrders.basisFor({
    eventId: event.value?.id ?? null,
    pointId: event.value?.pointId ?? null,
    noRepairNote: String(closeModel.value.noRepairNote ?? ''),
  }),
)
const readyToClose = computed(() => canClose.value && closeBasisCheck.value.ok)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    message.value = ''
    closeOpen.value = false
    transferOpen.value = false
    closeModel.value = { basis: '', noRepairNote: '' }
    // 打开详情即视为已展示该事件的通知；未接入真实渠道，不写"已送达"
    // 同时把工单读进来：关闭依据要看关联工单是否已验收通过
    if (!workOrders.loaded) await workOrders.reload()
    await events.markPresented(props.eventId)
  },
)

async function acknowledge(): Promise<void> {
  if (event.value === undefined) return
  await events.acknowledgeEvent(event.value.id)
  message.value = `已由 ${session.name} 确认，事件转入处理中`
  tone.value = 'ok'
}

function eventIssueSeed(): string {
  if (event.value === undefined) return ''
  const last = event.value.evidences[event.value.evidences.length - 1]
  const evidence = last === undefined ? '暂无活跃越限证据，需现场核查' : `最近证据 ${last.recordNo}，触发值 ${fmtNumber(last.triggerValue, 2)} ${event.value.unit}`
  return `预警事件 ${event.value.eventNo}（${EVENT_LEVEL_LABEL[event.value.level]}）：${evidence}，请安排现场排查与处置。`
}

function onIssueCreated(payload: { issueNo: string; duplicated: boolean }): void {
  transferOpen.value = false
  message.value = payload.duplicated
    ? `已关联既有问题 ${payload.issueNo}，同一预警事件未重复建单`
    : `已创建关联问题 ${payload.issueNo}，请到“问题与工单”继续审核处置`
  tone.value = 'ok'
}

async function confirmClose(): Promise<void> {
  if (event.value === undefined) return
  const basis = String(closeModel.value.basis ?? '').trim()
  const noRepairNote = String(closeModel.value.noRepairNote ?? '').trim()
  if (basis === '') {
    message.value = '关闭必须填写关闭依据'
    tone.value = 'bad'
    return
  }
  try {
    await events.closeEvent(event.value.id, { basis, noRepairNote })
    closeOpen.value = false
    message.value = `事件已关闭：${closeBasisCheck.value.reason}｜关闭人与依据已留痕，关联问题时间线已同步`
    tone.value = 'ok'
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : String(cause)
    tone.value = 'bad'
  }
}

function levelTone(level: EventLevel): 'yellow' | 'orange' | 'red' {
  return level
}

function statusTone(status: EventStatus): 'red' | 'orange' | 'brand' | 'gray' {
  if (status === 'pending') return 'red'
  if (status === 'handling') return 'orange'
  if (status === 'recovering') return 'brand'
  return 'gray'
}

function locationText(): string {
  const target = point.value
  if (target === undefined) return '—'
  const building = archive.buildingById(target.buildingId)
  const floor = archive.floorById(target.floorId)
  return `${building?.name ?? ''} ${floor?.name ?? ''}｜${target.zoneId}`.trim()
}
</script>

<template>
  <AppModal
    :open="open && event !== undefined"
    :title="event === undefined ? '' : `预警事件 · ${event.eventNo}`"
    :sub="event === undefined ? '' : `${archive.pointLabel(event.pointId)}｜规则 ${event.ruleCode}`"
    :width="880"
    @close="emit('close')"
  >
    <template v-if="event !== undefined">
      <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

      <div class="row wrap head-row">
        <StatusTag :tone="levelTone(event.level)" :text="`当前${EVENT_LEVEL_LABEL[event.level]}`" />
        <StatusTag :tone="levelTone(event.peakLevel)" :text="`最高${EVENT_LEVEL_LABEL[event.peakLevel]}`" :dot="false" />
        <StatusTag :tone="statusTone(event.status)" :text="EVENT_STATUS_LABEL[event.status]" />
        <span class="code">位置：{{ locationText() }}</span>
      </div>

      <p v-if="!canClose && event.status !== 'closed'" class="field-hint close-hint">
        关闭条件：{{ closePermission.reason }}
      </p>
      <p v-if="event.status === 'closed' && openRelatedIssues.length > 0" class="notice notice--warn">
        本预警事件已关闭，但关联问题仍有 {{ openRelatedIssues.length }} 条未关闭（{{ openRelatedIssues.map((row) => row.issueNo).join('、') }}）。
        请在“问题与工单”继续完成复查或问题关闭；事件关闭不等于问题关闭。
      </p>

      <dl class="kv">
        <div><dt>事件编号</dt><dd class="num">{{ event.eventNo }}</dd></div>
        <div><dt>生成时间</dt><dd class="num">{{ formatDateTime(event.openedAt) }}</dd></div>
        <div><dt>生成人</dt><dd>{{ event.openedBy }}</dd></div>
        <div><dt>最近触发</dt><dd class="num">{{ formatDateTime(event.lastTriggerAt) }}</dd></div>
        <div><dt>最近触发值</dt><dd class="num">{{ fmtNumber(event.lastTriggerValue, 2) }} {{ event.unit }}</dd></div>
        <div><dt>证据条数 / 升级次数</dt><dd class="num">{{ event.evidences.length }} / {{ event.upgrades.length }}</dd></div>
        <div><dt>确认人</dt><dd>{{ event.acknowledgedBy === '' ? '待确认' : `${event.acknowledgedBy}（${formatDateTime(event.acknowledgedAt ?? '')}）` }}</dd></div>
        <div><dt>关闭人</dt><dd>{{ event.closedBy === '' ? '未关闭' : `${event.closedBy}（${formatDateTime(event.closedAt ?? '')}）` }}</dd></div>
        <div v-if="event.closeBasis !== ''" class="wide"><dt>关闭依据</dt><dd>{{ event.closeBasis }}</dd></div>
      </dl>

      <div class="block">
        <div class="block-title">证据链（{{ event.evidences.length }} 条活跃）</div>
        <p v-if="event.evidences.length === 0" class="notice notice--warn no-evidence">
          当前没有活跃越限证据：原证据已被记录修订撤销。事件不会因此自动关闭，
          等级与处置结论需由授权人员在复核后填写依据。
        </p>
        <DataTable
          :columns="[
            { key: 'no', label: '记录编号', width: '132px' },
            { key: 'time', label: '采样时间', width: '138px' },
            { key: 'level', label: '命中等级', width: '104px' },
            { key: 'trigger', label: '触发值', width: '100px' },
            { key: 'rule', label: '规则版本', width: '110px' },
            { key: 'basis', label: '判定依据' },
          ]"
          :row-count="event.evidences.length"
          empty="暂无证据"
        >
          <tr v-for="item in event.evidences" :key="item.recordId">
            <td class="code">{{ item.recordNo }}</td>
            <td class="num">{{ formatDateTime(item.sampleTime) }}</td>
            <td><StatusTag :tone="levelTone(item.level)" :text="EVENT_LEVEL_LABEL[item.level]" /></td>
            <td class="num">{{ fmtNumber(item.triggerValue, 2) }} {{ event.unit }}</td>
            <td class="code">{{ item.ruleVersion }}</td>
            <td>
              <div>{{ item.basis }}</div>
              <div class="code">
                阈值 {{ item.thresholds === null ? '环境条件' : `黄 ${item.thresholds.yellow} / 橙 ${item.thresholds.orange} / 红 ${item.thresholds.red}` }}｜基准
                {{ item.baselineValue === null ? '不设基准' : fmtNumber(item.baselineValue, 2) }}
              </div>
            </td>
          </tr>
        </DataTable>
      </div>

      <div v-if="event.supersededEvidences.length > 0" class="block">
        <div class="block-title">已替代证据（{{ event.supersededEvidences.length }} 条）</div>
        <p class="field-hint">记录修订后，原证据从活跃证据链移出但保留审计；同一条记录在事件中只有一条活跃证据。</p>
        <ul class="line-list">
          <li v-for="(item, index) in event.supersededEvidences" :key="index">
            <span class="code">{{ formatDateTime(item.supersededAt) }}</span>
            <span>{{ item.evidence.recordNo }}（原判定 {{ EVENT_LEVEL_LABEL[item.evidence.level] }}）</span>
            <span class="muted">触发值 {{ fmtNumber(item.evidence.triggerValue, 2) }}</span>
            <span class="muted">替代人 {{ item.supersededBy }}｜原因：{{ item.reason }}</span>
          </li>
        </ul>
      </div>

      <div v-if="event.upgrades.length > 0" class="block">
        <div class="block-title">升级历史（{{ event.upgrades.length }} 次）</div>
        <ul class="line-list">
          <li v-for="(item, index) in event.upgrades" :key="index">
            <span class="code">{{ formatDateTime(item.at) }}</span>
            <span>{{ EVENT_LEVEL_LABEL[item.from] }} → {{ EVENT_LEVEL_LABEL[item.to] }}</span>
            <span class="muted">{{ item.recordNo }}｜触发值 {{ fmtNumber(item.triggerValue, 2) }}｜规则 {{ item.ruleVersion }}</span>
            <span class="muted">{{ item.by }}</span>
          </li>
        </ul>
      </div>

      <div class="block">
        <div class="block-title">通知与确认（{{ notifications.length }} 条）</div>
        <DataTable
          :columns="[
            { key: 'target', label: '接收对象', width: '130px' },
            { key: 'created', label: '生成时间', width: '138px' },
            { key: 'due', label: '确认时限', width: '88px' },
            { key: 'state', label: '状态', width: '150px' },
            { key: 'ack', label: '确认人 / 升级去向' },
          ]"
          :row-count="notifications.length"
          empty="暂无通知记录"
        >
          <tr v-for="item in notifications" :key="item.id">
            <td>{{ item.target }}</td>
            <td class="num">{{ formatDateTime(item.createdAt) }}</td>
            <td class="num">{{ item.dueMinutes }} 分钟</td>
            <td>
              <StatusTag v-if="item.acknowledgedAt !== null" tone="green" text="已确认" />
              <StatusTag v-else-if="item.escalatedAt !== null" tone="orange" text="已升级" />
              <StatusTag v-else-if="item.presentedAt !== null" tone="brand" text="已展示" />
              <StatusTag v-else tone="gray" text="已生成" />
            </td>
            <td>
              <span v-if="item.acknowledgedBy !== ''">{{ item.acknowledgedBy }}</span>
              <span v-else-if="item.escalatedTo !== ''" class="muted">
                转 {{ item.escalatedTo }}<template v-if="item.escalationSource === 'demo'">（演示模拟）</template>
              </span>
              <span v-else class="muted">{{ item.fallback }}（超时去向）</span>
            </td>
          </tr>
        </DataTable>
      </div>

      <div class="block">
        <div class="block-title">事件时间线</div>
        <ul class="line-list">
          <li v-for="(item, index) in event.timeline" :key="index">
            <span class="code">{{ formatDateTime(item.at) }}</span>
            <span>{{ item.action }}</span>
            <span class="muted">{{ item.detail }}</span>
            <span class="muted">{{ item.by }}</span>
          </li>
        </ul>
      </div>
    </template>

    <template #footer>
      <AppButton @click="emit('close')">关闭窗口</AppButton>
      <AppButton v-if="canClose" variant="default" @click="closeOpen = true">关闭事件</AppButton>
      <AppButton v-if="canTransfer" variant="default" @click="transferOpen = true">转问题处理</AppButton>
      <AppButton v-if="canAcknowledge" variant="primary" @click="acknowledge">确认事件</AppButton>
    </template>
  </AppModal>

  <AppModal :open="closeOpen" title="关闭预警事件" sub="需数据恢复 + 处置依据，两项齐备才能关闭" :width="580" @close="closeOpen = false">
    <p class="notice notice--warn">
      数据恢复只把事件标为恢复待确认，不会自动关闭。关闭要同时满足：连续复测已回到恢复阈值以下、
      处置已完成（关联工单验收通过，或安全管理人员写明的"无需维修"现场核查结论）。
    </p>
    <p class="notice" :class="closeBasisCheck.ok ? 'notice--brand' : 'notice--warn'">
      处置依据：{{ closeBasisCheck.ok ? `已具备 —— ${closeBasisCheck.reason}` : `尚不具备 —— ${closeBasisCheck.reason}` }}
    </p>
    <FormGrid v-model="closeModel" :fields="closeFields" :columns="1" />
    <template #footer>
      <AppButton @click="closeOpen = false">取消</AppButton>
      <AppButton variant="primary" :disabled="!readyToClose" @click="confirmClose">确认关闭</AppButton>
    </template>
  </AppModal>

  <AppModal
    :open="transferOpen && event !== undefined"
    title="预警转问题处理"
    :sub="event === undefined ? '' : `${event.eventNo}｜${archive.pointLabel(event.pointId)}｜预填事件与测点`"
    :width="620"
    @close="transferOpen = false"
  >
    <EventIssueForm
      v-if="event !== undefined"
      :key="event.id"
      :event-id="event.id"
      :event-no="event.eventNo"
      :point-id="event.pointId"
      :description-seed="eventIssueSeed()"
      @done="onIssueCreated"
      @cancel="transferOpen = false"
    />
  </AppModal>
</template>

<style scoped>
.head-row {
  margin-bottom: 12px;
}

.kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  margin: 0;
}

.kv dt {
  font-size: 12px;
  color: var(--text-3);
}

.kv dd {
  margin: 0;
  font-size: 13.5px;
}

.kv .wide {
  grid-column: 1 / -1;
}

.block {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.line-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}

.line-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--canvas);
}

.notice {
  margin-bottom: 12px;
}

.close-hint {
  margin-bottom: 10px;
}

.no-evidence {
  margin-bottom: 10px;
}
</style>

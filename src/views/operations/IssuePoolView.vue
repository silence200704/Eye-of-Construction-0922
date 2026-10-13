<script setup lang="ts">
/**
 * 问题与工单工作台（V0.3）。
 *
 * 三类来源（传感器预警、巡检发现、人工上报）进同一个池子，按状态与位置筛选；
 * 人工上报在这里提交；审核由安全管理人员在详情里按"六个一级出口 + 二级分类"处理。
 * 工单部分随第四步后续接上（工单面板会挂在本页的详情里）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useIssueStore } from '@/stores/inspection/issues'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { ISSUE_SOURCES, ISSUE_STATUSES } from '@/types/inspection'
import type { InspectionIssue } from '@/types/inspection'
import SectionCard from '@/components/ui/SectionCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ManualIssueForm from '@/components/inspection/issue/ManualIssueForm.vue'
import IssueDetail from '@/components/inspection/issue/IssueDetail.vue'
import IssueTable from '@/components/inspection/issue/IssueTable.vue'
import AppDrawer from '@/components/ui/overlay/AppDrawer.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { recheckState } from '@/core/inspection/recheck'
import { resolveWorkOrderTarget } from '@/assistant/deepLink'
import { useRoute } from 'vue-router'
import { useClockStore } from '@/stores/clock'

const archive = useArchiveStore()
const session = useSessionStore()
const issues = useIssueStore()
const tasks = useTaskStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()

const route = useRoute()
const clock = useClockStore()
/** 共享刻度：逾期按“今天”算，跨天或页面久放时靠「刷新复查状态」推进（不引定时器）。 */
const today = computed(() => clock.todayKey)
const statusFilter = ref('')
const sourceFilter = ref('')
const buildingFilter = ref('')
const anomalyFilter = ref('')
/**
 * 保养页"故障工单"分区跳来时的范围：只看还没验收通过的工单。
 * 值来自路由 query（`?workOrder=open`），不读它就会出现"卡片写 N 张、进来看到全部"的错位。
 */
const workOrderOpenOnly = ref(false)
const formOpen = ref(false)
const activeId = ref('')
const highlightId = ref('')
/** 深链 `?workOrder=<工单ID>` 指向的那张工单：传给详情面板做定位高亮 */
const focusOrderId = ref('')
/**
 * 演示链的问题 id。
 * 演示场景生成的问题在描述里带「演示场景[...]」标记，据此把它们挑出来重点标注 ——
 * 演示时评审要能一眼找到"这条是刚才那个红色预警转下来的"。
 */
const demoIssueIds = computed(() =>
  issues.issues.filter((row) => row.description.includes('演示场景[')).map((row) => row.id),
)
/** 审核面板里是否有"填了一半没提交"的内容（由面板上报） */
const reviewDirty = ref(false)
/** 待执行的离开动作：null=不离开，''=关闭详情，其它=切换到该问题 */
const pendingLeave = ref<string | null>(null)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')

const anomalyTypes = computed(() => [...new Set(issues.issues.map((row) => row.anomalyType))].sort())

/**
 * 状态筛选项：状态统计卡与状态下拉**共用这一份**。
 * 「处理中」在数据上跨 repairing 与 investigating 两个状态，合并成一个筛选项 ——
 * 卡片按一组算、下拉按单个算的话，点了卡片条数就对不上，用户会以为筛选坏了。
 */
const STATUS_FILTERS: { key: string; name: string }[] = [
  { key: '', name: '全部' },
  ...ISSUE_STATUSES.filter((row) => row.key !== 'investigating').map((row) => ({
    key: row.key,
    name: row.key === 'repairing' ? '处理中（含排查中）' : row.name,
  })),
]

/** 单个状态是否命中筛选值（'handling' 是一组）。 */
function matchesStatus(issue: InspectionIssue, key: string): boolean {
  if (key === '') return true
  if (key === 'handling' || key === 'repairing') return issue.status === 'repairing' || issue.status === 'investigating'
  return issue.status === key
}

const filtered = computed(() =>
  issues.issues
    .filter((row) => !workOrderOpenOnly.value || rowWorkOrderOpen(row))
    .filter((row) => matchesStatus(row, statusFilter.value))
    .filter((row) => !onlyOverdue.value || recheckState(row, today.value).state === 'overdue')
    .filter((row) => sourceFilter.value === '' || row.source === sourceFilter.value)
    .filter((row) => buildingFilter.value === '' || row.buildingId === buildingFilter.value)
    .filter((row) => anomalyFilter.value === '' || row.anomalyType === anomalyFilter.value)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
)

const active = computed(() => (activeId.value === '' ? null : issues.byId(activeId.value) ?? null))

const summary = computed(() => ({
  pending: issues.pendingReview.length,
  handling: issues.issues.filter((row) => matchesStatus(row, 'handling')).length,
  recheck: issues.issues.filter((row) => row.status === 'pending_recheck').length,
  closed: issues.issues.filter((row) => row.status === 'closed').length,
}))

/** 状态统计卡：点一下按该状态筛选，再点一下取消。 */
const statusCards = computed(() => [
  { key: 'pending_review', tone: 'orange' as const, label: '待审核', count: summary.value.pending },
  { key: 'repairing', tone: 'brand' as const, label: '处理中', count: summary.value.handling },
  { key: 'pending_recheck', tone: 'green' as const, label: '待复查', count: summary.value.recheck },
  { key: 'closed', tone: 'gray' as const, label: '已关闭', count: summary.value.closed },
])

/** 只看复查逾期的开关：这是安全管理人员每天要清的队列，单独一个筛选比塞进状态下拉更直观。 */
const onlyOverdue = ref(false)
const overdueRows = computed(() => issues.issues.filter((row) => recheckState(row, today.value).state === 'overdue'))

const hasFilter = computed(
  () =>
    onlyOverdue.value ||
    statusFilter.value !== '' ||
    sourceFilter.value !== '' ||
    buildingFilter.value !== '' ||
    anomalyFilter.value !== '',
)

function toggleStatus(key: string): void {
  statusFilter.value = statusFilter.value === key ? '' : key
}

function clearFilters(): void {
  onlyOverdue.value = false
  statusFilter.value = ''
  sourceFilter.value = ''
  buildingFilter.value = ''
  anomalyFilter.value = ''
}

function notify(text: string, ok = true): void {
  tone.value = ok ? 'ok' : 'bad'
  message.value = text
}

/**
 * 人工上报成功后自动定位到新问题。
 *
 * 两件事必须一起做：
 * 1. **先清筛选**：新问题一定是"待审核"，当前若筛着"已关闭"或别的楼栋，它在列表里根本不出现，
 *    只设 activeId 会打开一个列表里找不到的抽屉；
 * 2. 打开抽屉 + 短暂高亮该行，让用户看见"刚建的就是这条"。
 */
function onReported(payload: { issueNo: string; note: string }): void {
  formOpen.value = false
  const cleared = hasFilter.value
  clearFilters()
  const created = issues.byNo(payload.issueNo)
  notify(`已提交问题 ${payload.issueNo}${payload.note}${cleared ? '；已清除筛选以便定位' : ''}`)
  if (created === undefined) return
  activeId.value = created.id
  highlightId.value = created.id
  window.setTimeout(() => {
    if (highlightId.value === created.id) highlightId.value = ''
  }, 2600)
}

/**
 * 离开详情前的统一闸门：切换问题、Esc / 关闭按钮、面板自己的关闭按钮三条路都走这里。
 *
 * 审核意见填到一半被静默丢掉等于白填，而且用户会以为已经提交了 ——
 * 所以有未提交内容时先问一句，确认放弃才离开。
 */
function requestLeave(nextId: string): void {
  if (reviewDirty.value) {
    pendingLeave.value = nextId
    return
  }
  applyLeave(nextId)
}

function applyLeave(nextId: string): void {
  pendingLeave.value = null
  reviewDirty.value = false
  activeId.value = nextId
}

/** 按当前日期重算复查逾期：跨天或长时间停留后点一下即可。 */
function refreshRecheck(): void {
  clock.refresh()
  notify(`已按当前日期刷新复查状态：复查逾期 ${overdueRows.value.length} 条`)
}

function requestClose(): void {
  requestLeave('')
}

function requestOpen(id: string): void {
  // 点同一行 = 收起
  requestLeave(activeId.value === id ? '' : id)
}

/**
 * 详情里的动作改完之后：提示 + 重读两个仓储。
 *
 * 重读这一下是必须的：验收通过会**在工单事务里一并改写问题状态**，
 * 数据已落库，但列表与详情渲染的是内存里那份，不重读就一直显示旧状态
 * （页面上会出现"数据库已是待复查、列表还是处理中"这种对不上的情况）。
 */
async function onChanged(text: string): Promise<void> {
  notify(text)
  await Promise.all([issues.reload(), workOrders.reload()])
}

onMounted(async () => {
  if (!issues.loaded) await issues.reload()
  if (!tasks.loaded) await tasks.reload()
  if (!workOrders.loaded) await workOrders.reload()
  if (!attachments.loaded) await attachments.reload()
})

/**
 * 深链参数（一个 watch 读同一处路由状态）：
 * - `?issue=<id>` 直接展开那条问题；
 * - `?workOrder=open` 只看名下还有未验收通过工单的问题 —— 与保养页「故障工单」卡片的条数口径一致；
 * - `?workOrder=<工单ID>` 展开该工单所属问题并定位到这张工单（助手回答里的"打开工单"走这条）。
 */
watch(
  [() => route.query.issue, () => route.query.workOrder],
  async ([issue, workOrder]) => {
    workOrderOpenOnly.value = workOrder === 'open'
    await focusWorkOrderLink(workOrder)
    if (typeof issue !== 'string' || issue === '') return
    activeId.value = issue
    highlightId.value = issue
  },
  { immediate: true },
)

/**
 * 按深链定位工单：先把工单与问题读进来再判定"找不到"，
 * 因为 watch 的 immediate 首次执行早于 onMounted，那时仓储还空着。
 */
async function focusWorkOrderLink(value: unknown): Promise<void> {
  if (value === undefined || value === '' || value === 'open') return
  if (!issues.loaded) await issues.reload()
  if (!workOrders.loaded) await workOrders.reload()
  const target = resolveWorkOrderTarget(value, (id) => {
    const row = workOrders.byId(id)
    return row === undefined ? undefined : { id: row.id, issueId: row.issueId, orderNo: row.orderNo }
  })
  focusOrderId.value = target.id
  if (target.reason !== '') return notify(target.reason, false)
  activeId.value = target.issueId
  highlightId.value = target.issueId
}

/** 该问题名下是否还有未验收通过的工单。 */
function rowWorkOrderOpen(row: InspectionIssue): boolean {
  return row.workOrderIds.some((id) => {
    const order = workOrders.byId(id)
    return order !== undefined && order.status !== 'verified'
  })
}
</script>

<template>
  <div class="stack">
    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <SectionCard title="问题与工单" sub="预警、巡检发现、人工上报进同一个池；审核留痕后转维修工单" marked>
      <div class="summary">
        <button
          v-for="card in statusCards"
          :key="card.key"
          class="card-btn"
          :class="{ 'card-btn--on': statusFilter === card.key }"
          type="button"
          :aria-pressed="statusFilter === card.key"
          @click="toggleStatus(card.key)"
        >
          <StatusTag :tone="card.tone" :text="`${card.label} ${card.count}`" />
        </button>
        <span class="muted">共 {{ issues.issues.length }} 条问题｜工单 {{ workOrders.orders.length }} 张</span>
      </div>

      <div class="row wrap filters">
        <label class="field">
          <span>状态</span>
          <select v-model="statusFilter" class="ctl">
            <option v-for="row in STATUS_FILTERS" :key="row.key" :value="row.key">{{ row.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>来源</span>
          <select v-model="sourceFilter" class="ctl">
            <option value="">全部</option>
            <option v-for="row in ISSUE_SOURCES" :key="row.key" :value="row.key">{{ row.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>楼栋</span>
          <select v-model="buildingFilter" class="ctl">
            <option value="">全部</option>
            <option v-for="row in archive.buildings" :key="row.id" :value="row.id">{{ row.code }} {{ row.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>异常类型</span>
          <select v-model="anomalyFilter" class="ctl">
            <option value="">全部</option>
            <option v-for="item in anomalyTypes" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <AppButton size="sm" variant="primary" @click="formOpen = !formOpen">
          {{ formOpen ? '收起上报' : '人工上报问题' }}
        </AppButton>
      </div>

      <div class="row-between match-row">
        <span class="muted">
          当前匹配 {{ filtered.length }} 条 / 共 {{ issues.issues.length }} 条<span v-if="hasFilter">（已筛选）</span>
        </span>
        <span class="row">
          <button
            class="link"
            :class="{ 'link--on': onlyOverdue }"
            type="button"
            :aria-pressed="onlyOverdue"
            @click="onlyOverdue = !onlyOverdue"
          >
            只看复查逾期（{{ overdueRows.length }}）
          </button>
          <button class="link" type="button" @click="refreshRecheck">刷新复查状态</button>
          <button v-if="hasFilter" class="link" type="button" @click="clearFilters">清除全部筛选</button>
        </span>
      </div>

      <div v-if="formOpen" class="form-wrap">
        <ManualIssueForm @done="onReported" @cancel="formOpen = false" />
      </div>

      <EmptyState
        v-if="issues.issues.length === 0"
        title="问题池还是空的"
        sub="三类来源都会进这里：传感器预警转单、巡检发现问题、人工上报。也可以点上面的「人工上报问题」先建一条"
      />
      <template v-else>
        <IssueTable
          :rows="filtered"
          :active-id="activeId"
          :highlight-id="highlightId"
          :demo-ids="demoIssueIds"
          @open="requestOpen"
        />
      </template>

      <p class="field-hint">
        「关联既有对象」会保留两条记录并写上关联关系与时间线，不会把现场事实合并掉。
        审核由学校安全管理人员执行（当前身份：{{ session.roleLabel }}）。
      </p>
    </SectionCard>

    <!--
      详情放右侧抽屉而不是表格下方：列表不卸载，筛选与滚动位置都留着，
      抽屉开着还能继续点别的行换详情。
    -->
    <AppDrawer
      :open="active !== null"
      :title="active === null ? '' : `问题 ${active.issueNo}`"
      :width="560"
      @close="requestClose"
    >
      <!-- key 绑到问题 ID：切换问题时整个面板重建，避免把上一条的填写内容带到新问题上 -->
      <IssueDetail
        v-if="active !== null"
        :key="active.id"
        :issue="active"
        :focus-order-id="focusOrderId"
        @changed="onChanged"
        @review-dirty="reviewDirty = $event"
        @close="requestClose"
      />
    </AppDrawer>

    <AppModal
      :open="pendingLeave !== null"
      title="存在未提交的审核内容"
      sub="离开后这次填写的审核意见、照片与关联选择都会丢弃"
      :width="460"
      @close="pendingLeave = null"
    >
      <p class="notice notice--warn">
        审核表单里还有没提交的内容。现在离开不会保存，也不会写入时间线与操作日志。
      </p>
      <template #footer>
        <AppButton @click="pendingLeave = null">继续填写</AppButton>
        <AppButton variant="primary" @click="applyLeave(pendingLeave ?? '')">放弃并离开</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped src="./styles/IssuePoolView.css"></style>

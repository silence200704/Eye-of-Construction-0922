<script setup lang="ts">
/**
 * 问题与工单工作台（V0.3）。
 *
 * 三类来源（传感器预警、巡检发现、人工上报）进同一个池子，按状态与位置筛选；
 * 人工上报在这里提交；审核由安全管理人员在详情里按"六个一级出口 + 二级分类"处理。
 * 工单部分随第四步后续接上（工单面板会挂在本页的详情里）。
 */
import { computed, onMounted, ref } from 'vue'
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
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ManualIssueForm from '@/components/inspection/issue/ManualIssueForm.vue'
import IssueDetail from '@/components/inspection/issue/IssueDetail.vue'
import AppDrawer from '@/components/ui/overlay/AppDrawer.vue'
import AppModal from '@/components/ui/AppModal.vue'

const archive = useArchiveStore()
const session = useSessionStore()
const issues = useIssueStore()
const tasks = useTaskStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()

const statusFilter = ref('')
const sourceFilter = ref('')
const buildingFilter = ref('')
const anomalyFilter = ref('')
const formOpen = ref(false)
const activeId = ref('')
const highlightId = ref('')
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
    .filter((row) => matchesStatus(row, statusFilter.value))
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

const hasFilter = computed(
  () => statusFilter.value !== '' || sourceFilter.value !== '' || buildingFilter.value !== '' || anomalyFilter.value !== '',
)

function toggleStatus(key: string): void {
  statusFilter.value = statusFilter.value === key ? '' : key
}

function clearFilters(): void {
  statusFilter.value = ''
  sourceFilter.value = ''
  buildingFilter.value = ''
  anomalyFilter.value = ''
}

function notify(text: string, ok = true): void {
  tone.value = ok ? 'ok' : 'bad'
  message.value = text
}

function sourceName(key: string): string {
  return ISSUE_SOURCES.find((row) => row.key === key)?.name ?? key
}

function statusName(key: string): string {
  return ISSUE_STATUSES.find((row) => row.key === key)?.name ?? key
}

function statusTone(issue: InspectionIssue): 'orange' | 'brand' | 'green' | 'gray' {
  if (issue.status === 'pending_review') return 'orange'
  if (issue.status === 'closed') return 'gray'
  if (issue.status === 'pending_recheck') return 'green'
  return 'brand'
}

function locationOf(issue: InspectionIssue): string {
  const floor = archive.floorById(issue.floorId)?.name ?? issue.floorId
  return `${archive.buildingName(issue.buildingId)} ${floor} ${issue.zoneId}`
}

function taskLabelOf(issue: InspectionIssue): string {
  if (issue.taskId === null) return '—'
  return tasks.byId(issue.taskId)?.taskNo ?? '（任务已删除）'
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
        <button v-if="hasFilter" class="link" type="button" @click="clearFilters">清除全部筛选</button>
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
        <DataTable
          :columns="[
            { key: 'no', label: '问题编号', width: '168px' },
            { key: 'source', label: '来源', width: '96px' },
            { key: 'place', label: '位置' },
            { key: 'type', label: '异常类型', width: '110px' },
            { key: 'task', label: '关联任务', width: '150px' },
            { key: 'status', label: '状态', width: '92px' },
            { key: 'act', label: '操作', width: '78px' },
          ]"
          :row-count="filtered.length"
          empty="当前筛选条件下没有问题"
        >
          <tr
            v-for="row in filtered"
            :key="row.id"
            :class="{ 'row--active': activeId === row.id, 'row--flash': highlightId === row.id }"
          >
            <td class="mono">{{ row.issueNo }}</td>
            <td>{{ sourceName(row.source) }}</td>
            <td>
              {{ locationOf(row) }}
              <div class="muted">{{ row.description.slice(0, 40) }}</div>
            </td>
            <td>{{ row.anomalyType }}</td>
            <td class="mono">{{ taskLabelOf(row) }}</td>
            <td><StatusTag :tone="statusTone(row)" :text="statusName(row.status)" /></td>
            <td>
              <button class="link" type="button" @click="requestOpen(row.id)">
                {{ activeId === row.id ? '收起' : '详情' }}
              </button>
            </td>
          </tr>
        </DataTable>
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
      :sub="active === null ? '' : `${sourceName(active.source)}｜${locationOf(active)}`"
      :width="560"
      @close="requestClose"
    >
      <!-- key 绑到问题 ID：切换问题时整个面板重建，避免把上一条的填写内容带到新问题上 -->
      <IssueDetail
        v-if="active !== null"
        :key="active.id"
        :issue="active"
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

<style scoped>
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

/* 状态统计卡做成按钮：整块可点、键盘可聚焦，选中的那张加外圈 */
.card-btn {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  border-radius: 999px;
  line-height: 0;
}

.card-btn:focus-visible,
.card-btn--on {
  outline: 2px solid var(--brand-700, #0b5762);
  outline-offset: 2px;
}

.match-row {
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

/* 抽屉正看着的那一行：底色标出来，关了抽屉就恢复 */
tr.row--active > td {
  background: var(--bg-2, #f6f8f8);
}

/* 刚新建/刚被定位的那一行：短暂高亮后自动淡回，配合提示文案说明"就是这条" */
tr.row--flash > td {
  background: #fff3cd;
  transition: background 0.5s ease;
}

.filters {
  gap: 10px;
  align-items: flex-end;
  margin-bottom: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-3);
}

.field .ctl {
  min-width: 140px;
}

.form-wrap {
  border: 1px solid var(--brand-300, #9dc6cd);
  border-radius: var(--r-sm);
  padding: 14px;
  margin-bottom: 14px;
  background: var(--bg-2, #f6f8f8);
}

.detail-wrap {
  margin-top: 14px;
  border: 1px solid var(--brand-300, #9dc6cd);
  border-radius: var(--r-sm);
  padding: 14px;  background: var(--paper);
}

.link {
  border: 0;
  background: none;
  color: var(--brand-700);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}
</style>

<script setup lang="ts">
/**
 * 单个点位的到点打卡面板。
 *
 * 口径（方案 §3 + 评审确定）：
 * - 纯前端阶段的读卡是**模拟**的，界面必须写明，不构成真实到场证明；
 * - 编号一致或人工兜底写清原因才进入"已到点，待检查"；编号不一致只留痕；
 * - 已完成的点再扫错卡不会退回；
 * - 必答清单答完、异常项已建问题或写明依据，才能提交"检查完成"。
 */
import { computed, ref, watch } from 'vue'
import type { ChecklistAnswer, CheckMethod, TaskCheckResult } from '@/types/inspection'
import { checkIn, NFC_DISCLAIMER } from '@/core/inspection/checkIn'
import { formatDateTime } from '@/core/time'
import type { Point } from '@/types/domain'
import StatusTag from '@/components/ui/StatusTag.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = withDefaults(
  defineProps<{
    point: Point | undefined
    result: TaskCheckResult
    saving?: boolean
    /** 已关联问题的编号，用于显示"异常已关联 ISS-…" */
    issueLabel?: string
  }>(),
  { issueLabel: '' },
)
const emit = defineEmits<{
  /** 到点尝试：交给仓储校验角色与规则后落库 */
  checkIn: [input: { labelRead: string; method: CheckMethod; fallbackReason: string }]
  /** 提交检查完成：answers + 关联的真实问题 ID / 无需建问题依据 */
  complete: [payload: { answers: ChecklistAnswer[]; linkedIssueId: string | null; noIssueReason: string }]
  /** 请求上报问题（页面切到问题表单） */
  requestIssue: []
}>()

const labelRead = ref('')
const fallbackReason = ref('')
const method = ref<CheckMethod>('nfc')
const answers = ref<ChecklistAnswer[]>([])
const noIssueReason = ref('')
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')

const expected = computed(() => props.point?.nfc?.code ?? '')
const expectedVersion = computed(() => props.point?.nfc?.version ?? null)
const status = computed(() => props.result.status)
const attempts = computed(() => [...props.result.attempts].reverse())

/**
 * 清单作答的初始化时机。
 *
 * 只在"换点位"或"已提交完成（以库里为准）"时重置 —— 不能用 deep watch 盯着整份结果：
 * 关联问题、重载任务都会换来一个新的结果对象，那样会把用户已经勾好的清单项清掉，
 * 现场表现就是"关联完问题还要重新勾一遍"。
 */
function initialize(row: TaskCheckResult): void {
  answers.value = row.checklist.map((item) => ({ ...item }))
  noIssueReason.value = row.abnormalHandling.reason
  labelRead.value = ''
  fallbackReason.value = ''
}

watch(() => props.result.pointId, () => initialize(props.result), { immediate: true })
watch(
  () => props.result.status,
  (status) => {
    if (status === 'completed') initialize(props.result)
  },
)

const statusMeta = computed(() => {
  if (status.value === 'completed') return { tone: 'green' as const, text: '检查完成' }
  if (status.value === 'arrived') return { tone: 'orange' as const, text: '已到点，待检查' }
  return { tone: 'gray' as const, text: '待到点' }
})

const abnormalCount = computed(() => answers.value.filter((row) => row.result === 'abnormal').length)

/** 模拟读卡：纯前端没有真实硬件，按钮把登记编号填进来，等价于"读到这张卡"。 */
function simulateRead(): void {
  labelRead.value = expected.value
  method.value = 'nfc'
  message.value = `已模拟读到 ${expected.value}（v${expectedVersion.value ?? 1}）；这是页面带入的编号，不是真实读卡`
  tone.value = 'ok'
}

const linkedIssueId = computed(() => props.result.abnormalHandling.linkedIssueId)
const linkedIssueNo = computed(() => props.issueLabel ?? linkedIssueId.value ?? '')

/** 本地先算一遍用于即时提示；真正的判定与落库在仓储入口里再做一次 */
function submitCheckIn(): void {
  const point = props.point
  if (point === undefined) {
    tone.value = 'bad'
    message.value = '该点位档案不存在或已归档，无法核对标签；请到档案页确认'
    return
  }
  const out = checkIn({ labelRead: labelRead.value, method: method.value, fallbackReason: fallbackReason.value, point, at: new Date().toISOString() })
  tone.value = out.passed ? 'ok' : 'bad'
  message.value = out.message
  emit('checkIn', { labelRead: labelRead.value, method: method.value, fallbackReason: fallbackReason.value })
}

function submitComplete(): void {
  emit('complete', {
    answers: answers.value,
    linkedIssueId: linkedIssueId.value,
    noIssueReason: noIssueReason.value,
  })
}

function setAnswer(key: string, result: 'ok' | 'abnormal'): void {
  answers.value = answers.value.map((row) => (row.key === key ? { ...row, result } : row))
}
</script>

<template>
  <div class="checkin">
    <div class="row-between head">
      <div class="who">
        <b>{{ point?.code ?? result.pointId }}</b>
        <span class="muted">{{ point?.name ?? '（点位档案已归档）' }}</span>
      </div>
      <StatusTag :tone="statusMeta.tone" :text="statusMeta.text" />
    </div>

    <p class="notice notice--warn disclaimer">{{ NFC_DISCLAIMER }}</p>

    <dl class="labels">
      <div><dt>登记标签</dt><dd class="mono">{{ expected === '' ? '未登记' : expected }}</dd></div>
      <div><dt>标签版本</dt><dd class="mono">v{{ expectedVersion ?? '—' }}</dd></div>
      <div><dt>到点时间</dt><dd class="mono">{{ result.checkedAt === null ? '—' : formatDateTime(result.checkedAt) }}</dd></div>
      <div><dt>尝试次数</dt><dd class="num">{{ result.attempts.length }}</dd></div>
    </dl>

    <div class="row wrap actions">
      <AppButton size="sm" :disabled="expected === ''" @click="simulateRead">模拟读取标签</AppButton>
      <input v-model="labelRead" class="ctl read" placeholder="读到的标签编号（可手动输入错号验证留痕）" />
      <select v-model="method" class="ctl">
        <option value="nfc">模拟 NFC 读卡</option>
        <option value="manual">人工兜底签到</option>
      </select>
      <input
        v-if="method === 'manual'"
        v-model="fallbackReason"
        class="ctl"
        placeholder="人工兜底原因（必填，例如标签磨损读不出）"
      />
      <AppButton size="sm" variant="primary" :disabled="saving === true" @click="submitCheckIn">提交到点</AppButton>
    </div>

    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <details v-if="attempts.length > 0" class="attempts">
      <summary>到点尝试历史（{{ attempts.length }} 次，失败也留痕）</summary>
      <ul>
        <li v-for="(row, index) in attempts" :key="index" :class="row.passed ? 'ok' : 'bad'">
          <span class="mono">{{ formatDateTime(row.at) }}</span>
          <span>{{ row.passed ? '通过' : '未通过' }}</span>
          <span class="mono">{{ row.method === 'nfc' ? '模拟读卡' : '人工兜底' }}</span>
          <span>{{ row.message }}</span>
        </li>
      </ul>
    </details>

    <div class="checklist">
      <p class="title">检查清单</p>
      <p v-if="answers.length === 0" class="muted">该计划没有配置检查项，到点后可直接提交检查完成。</p>
      <div v-for="row in answers" :key="row.key" class="item">
        <span class="label">{{ row.label }}</span>
        <div class="row">
          <button type="button" class="choice" :class="row.result === 'ok' ? 'choice--active' : ''" @click="setAnswer(row.key, 'ok')">正常</button>
          <button type="button" class="choice" :class="row.result === 'abnormal' ? 'choice--abnormal' : ''" @click="setAnswer(row.key, 'abnormal')">异常</button>
        </div>
      </div>
    </div>

    <div v-if="abnormalCount > 0" class="abnormal">
      <p class="notice notice--warn">
        有 {{ abnormalCount }} 项异常。请上报问题并关联到本点位，或写明"无需建问题"的依据（不少于 10 个字）。
        依据会写入操作日志，事后可倒查。
      </p>
      <div v-if="linkedIssueId !== null" class="row wrap">
        <p class="linked">
          已关联问题：<b class="mono">{{ linkedIssueNo }}</b>
        </p>
        <AppButton size="sm" @click="emit('requestIssue')">补传照片</AppButton>
      </div>
      <div v-else class="row wrap">
        <input v-model="noIssueReason" class="ctl" placeholder="无需建问题的依据（例如：读数稳定，现场观察后无需处理）" />
        <AppButton size="sm" @click="emit('requestIssue')">上报问题并关联</AppButton>
      </div>
    </div>

    <div class="row-between foot">
      <AppButton size="sm" @click="emit('requestIssue')">上报问题（不必先查完）</AppButton>
      <AppButton size="sm" variant="primary" :disabled="status !== 'arrived'" @click="submitComplete">提交检查完成</AppButton>
    </div>
  </div>
</template>

<style scoped>
.checkin {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 12px 14px;
  background: var(--paper);
}

.head {
  gap: 8px;
}

.who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--text-1);
}

.disclaimer {
  margin: 0;
  font-size: 11.5px;
}

.labels {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  font-size: 11.5px;
}

.labels dt {
  color: var(--text-3);
}

.labels dd {
  margin: 2px 0 0;
  color: var(--text-1);
}

.actions {
  gap: 8px;
}

.read {
  min-width: 220px;
}

.attempts ul {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 11.5px;
  line-height: 1.7;
}

.attempts li {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.attempts li.bad {
  color: var(--st-red, #c0362c);
}

.checklist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 12px;
  color: var(--text-2);
  margin: 0;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
}

.label {
  color: var(--text-1);
}

.choice {
  border: 1px solid var(--line);
  background: var(--paper);
  border-radius: var(--r-sm);
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-2);
}

.choice--active {
  border-color: #1e7a54;
  color: #1e7a54;
}

.choice--abnormal {
  border-color: #c0362c;
  color: #c0362c;
}

.foot {
  border-top: 1px solid var(--line);
  padding-top: 8px;
}

.linked {
  font-size: 12.5px;
  color: var(--text-1);
  margin: 0;
}
</style>

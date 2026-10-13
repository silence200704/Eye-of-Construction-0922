<script setup lang="ts">
/**
 * 复查与观察期（挂在问题详情里）。
 *
 * 方案 §4 的四条口径都体现在这里：
 * 1. **必须登记**：进入待复查后先登记复查事项、责任人与目标日期，否则只显示"还没安排复查"；
 * 2. **系统不替人下结论**：确认恢复 / 继续观察 / 复发转处置三种由人明确选择；
 * 3. **逾期只进待办**：逾期显示天数，状态与结论一概不动（不会自动关闭问题）；
 * 4. **能回看**：结论写进时间线时会带上原工单与预警事件编号。
 */
import { computed, ref } from 'vue'
import type { InspectionIssue, RecheckOutcome } from '@/types/inspection'
import { ISSUE_STATUSES, RECHECK_OUTCOMES } from '@/types/inspection'
import { useIssueStore } from '@/stores/inspection/issues'
import { useSessionStore } from '@/stores/session'
import { useClockStore } from '@/stores/clock'
import { DEMO_PEOPLE, MANUAL_OWNER } from '@/config/people'
import { activeRound, needsRecheck, recheckState, roundsOf, RECHECK_MIN_LENGTH } from '@/core/inspection/recheck'
import AppButton from '@/components/ui/AppButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'

const props = defineProps<{ issue: InspectionIssue }>()
const emit = defineEmits<{ changed: [message: string] }>()

const issues = useIssueStore()
const session = useSessionStore()
const clock = useClockStore()

const registerOpen = ref(false)
const outcomeOpen = ref(false)
const busy = ref(false)
const message = ref('')
const tone = ref<'ok' | 'bad'>('ok')

const subject = ref('')
/** 责任人：默认从演示人员名单里选，选"其他人员"才手动填写。名单只是减少输入，不代表权限。 */
const ownerPick = ref(DEMO_PEOPLE[0]?.name ?? MANUAL_OWNER)
const ownerManual = ref('')
const owner = computed(() => (ownerPick.value === MANUAL_OWNER ? ownerManual.value : ownerPick.value))
const dueDate = ref('')
const outcome = ref<RecheckOutcome>('recovered')
const note = ref('')
const nextDueDate = ref('')

const rounds = computed(() => roundsOf(props.issue))
const open = computed(() => activeRound(props.issue))
const due = computed(() => recheckState(props.issue, clock.todayKey))
const canWrite = computed(() => session.role === 'safety' && needsRecheck(props.issue))
const visible = computed(() => needsRecheck(props.issue) || rounds.value.length > 0)
/** 目标日期早于今天就属于"登记即逾期"：不拦，但要说清楚。 */
const pastDueDate = computed(() => dueDate.value !== '' && dueDate.value < clock.todayKey)

const statusLabel = computed(() => ISSUE_STATUSES.find((row) => row.key === props.issue.status)?.name ?? props.issue.status)
const outcomeLabel = (key: RecheckOutcome | null): string =>
  key === null ? '待复查' : RECHECK_OUTCOMES.find((row) => row.key === key)?.name ?? key

function notify(text: string, ok: boolean): void {
  tone.value = ok ? 'ok' : 'bad'
  message.value = text
}

async function submitRegister(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const out = await issues.registerRecheck(props.issue.id, { subject: subject.value, owner: owner.value, dueDate: dueDate.value })
    if (!out.ok) {
      notify(out.error, false)
      return
    }
    notify(`已登记复查：责任人 ${owner.value}，目标日期 ${dueDate.value}`, true)
    registerOpen.value = false
    subject.value = ''
    ownerPick.value = DEMO_PEOPLE[0]?.name ?? MANUAL_OWNER
    ownerManual.value = ''
    dueDate.value = ''
    emit('changed', message.value)
  } catch (cause) {
    // 仓储已把事务异常转成失败结果，这里是最后的兜底：页面不能只剩一条控制台错误
    notify(`保存失败，未写入数据：${(cause as Error).message}（可重试）`, false)
  } finally {
    busy.value = false
  }
}

async function submitOutcome(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const out = await issues.recordRecheckOutcome(props.issue.id, {
      outcome: outcome.value,
      note: note.value,
      nextDueDate: nextDueDate.value,
    })
    if (!out.ok) {
      notify(out.error, false)
      return
    }
    notify(`复查结论已记录：${outcomeLabel(outcome.value)}`, true)
    outcomeOpen.value = false
    note.value = ''
    nextDueDate.value = ''
    emit('changed', message.value)
  } catch (cause) {
    notify(`保存失败，未写入数据：${(cause as Error).message}（可重试）`, false)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="visible" class="recheck">
    <div class="row-between">
      <p class="section">复查与观察期</p>
      <div class="row">
        <AppButton v-if="canWrite && open === undefined" size="sm" variant="primary" @click="registerOpen = !registerOpen">
          {{ registerOpen ? '收起' : '登记复查' }}
        </AppButton>
        <AppButton v-if="canWrite && open !== undefined" size="sm" variant="primary" @click="outcomeOpen = !outcomeOpen">
          {{ outcomeOpen ? '收起' : '记录复查结论' }}
        </AppButton>
      </div>
    </div>

    <!-- 当前轮次：事项、责任人、目标日期与到期状态 -->
    <div v-if="open !== undefined" class="round">
      <div class="row-between">
        <div>
          <b>{{ open.subject }}</b>
          <div class="muted">责任人：{{ open.owner }}｜目标日期：{{ open.dueDate }}｜登记人：{{ open.by }}</div>
        </div>
        <StatusTag
          v-if="due.state === 'overdue'"
          tone="red"
          :text="`复查逾期 ${due.overdueDays} 天`"
        />
        <StatusTag v-else-if="due.state === 'due'" tone="orange" text="今天到期" />
        <StatusTag v-else tone="brand" :text="due.remainingDays === 0 ? '待复查' : `还有 ${due.remainingDays} 天`" />
      </div>
    </div>
    <p v-else-if="needsRecheck(issue)" class="muted">
      当前状态「{{ statusLabel }}」，但还没有登记复查安排：请登记复查事项、责任人与目标日期，否则到期没人跟进。
    </p>

    <!-- 登记表单 -->
    <div v-if="registerOpen" class="form">
      <label class="field">
        <span>复查事项 <b>*</b></span>
        <input v-model="subject" class="ctl" :placeholder="`要复查什么，例如 复测裂缝宽度并检查封闭层（不少于 ${RECHECK_MIN_LENGTH} 个字）`" />
      </label>
      <label class="field">
        <span>复查责任人 <b>*</b></span>
        <select v-model="ownerPick" class="ctl">
          <option v-for="person in DEMO_PEOPLE" :key="person.name" :value="person.name">{{ person.name }}</option>
          <option :value="MANUAL_OWNER">其他人员（手动填写）</option>
        </select>
        <input v-if="ownerPick === MANUAL_OWNER" v-model="ownerManual" class="ctl" placeholder="填写责任人姓名与部门，例如 陈老师（后勤保障处）" />
        <em class="field-hint">名单只是方便录入，不代表账号或权限；能否操作仍按当前演示身份校验</em>
      </label>
      <label class="field">
        <span>目标日期 <b>*</b></span>
        <input v-model="dueDate" class="ctl" type="date" />
        <em v-if="pastDueDate" class="field-hint">该日期已过：登记后会立刻显示为逾期（演示逾期待办时可用）</em>
      </label>
      <div class="row-between foot">
        <span class="muted">登记会写入问题时间线与操作日志</span>
        <AppButton size="sm" variant="primary" :disabled="busy" @click="submitRegister">
          {{ busy ? '提交中…' : '登记复查' }}
        </AppButton>
      </div>
    </div>

    <!-- 结论表单：三选一 -->
    <div v-if="outcomeOpen" class="form">
      <label class="field">
        <span>复查结论 <b>*</b></span>
        <select v-model="outcome" class="ctl">
          <option v-for="item in RECHECK_OUTCOMES" :key="item.key" :value="item.key">{{ item.name }}</option>
        </select>
        <em class="field-hint">{{ RECHECK_OUTCOMES.find((row) => row.key === outcome)?.hint }}</em>
      </label>
      <label v-if="outcome === 'observing'" class="field">
        <span>下一次复查目标日期 <b>*</b></span>
        <input v-model="nextDueDate" class="ctl" type="date" />
        <em class="field-hint">继续观察必须给出下一轮日期，否则观察期没有尽头</em>
      </label>
      <label class="field">
        <span>复查依据 <b>*</b></span>
        <textarea v-model="note" class="ctl" rows="3" :placeholder="`现场量测/观察到的实际情况（不少于 ${RECHECK_MIN_LENGTH} 个字），会与原工单、预警事件一起写进时间线`" />
      </label>
      <p class="notice notice--warn">
        复查结论只决定本条问题的去向：确认恢复→问题关闭（预警事件是否关闭另有条件）、继续观察→观察中并开下一轮、
        复发转处置→退回待审核重新安排处置（不新建无关问题）。
      </p>
      <div class="row-between foot">
        <span class="muted">结论会写入问题时间线与操作日志</span>
        <AppButton size="sm" variant="primary" :disabled="busy" @click="submitOutcome">
          {{ busy ? '提交中…' : '提交结论' }}
        </AppButton>
      </div>
    </div>

    <p v-if="message !== ''" class="notice" :class="tone === 'ok' ? 'notice--brand' : 'notice--warn'">{{ message }}</p>

    <!-- 轮次历史：已出结论的轮次全部保留 -->
    <details v-if="rounds.length > 0" class="history">
      <summary>复查轮次（{{ rounds.length }} 轮）</summary>
      <ul>
        <li v-for="(row, index) in rounds" :key="index">
          <span class="mono">{{ row.dueDate }}</span>
          <b>{{ outcomeLabel(row.outcome) }}</b>
          <span class="muted">责任人 {{ row.owner }}｜{{ row.subject }}</span>
          <span v-if="row.outcomeNote !== ''" class="muted">{{ row.outcomeBy }}：{{ row.outcomeNote }}</span>
        </li>
      </ul>
    </details>

    <p v-if="!canWrite && needsRecheck(issue)" class="muted">
      复查登记与结论由学校安全管理人员执行（当前身份：{{ session.roleLabel }}）。
    </p>
  </div>
</template>

<style scoped>
.recheck {
  border-top: 1px solid var(--line);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.round {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  background: var(--paper);
  font-size: 12.5px;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--brand-300, #9dc6cd);
  border-radius: var(--r-sm);
  padding: 12px;
  background: var(--bg-2, #f6f8f8);
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

.history ul {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 11.5px;
  line-height: 1.8;
}

.history li {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>

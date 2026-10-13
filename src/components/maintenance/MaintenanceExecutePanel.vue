<script setup lang="ts">
/**
 * 执行保养面板（任务详情里的写入入口）。
 *
 * 页面只收集这次提交的内容，**判定与落库全在写入侧**：
 * 清单必答、措施必填、下次保养日期合法、执行人是否负责人，都由 `tasks.execute` 里的纯函数判定，
 * 失败时数据库没有变化，提示也原样用 store 返回的 error。
 *
 * 异常只留痕或转问题：勾了「转问题处理」会由仓储在同一个事务里建一条来源为"保养发现"的问题；
 * 不勾时描述会写进任务备注 —— 否则"异常"只剩一个数字，事后查不出到底是什么异常。
 */
import { computed, ref, watch } from 'vue'
import type { ChecklistAnswer } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useSessionStore } from '@/stores/session'
import { useClockStore } from '@/stores/clock'
import { nextDueDateOf } from '@/core/maintenance/plan'
import PhotoUploader, { type PhotoDraft } from '@/components/inspection/PhotoUploader.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ task: MaintenanceTask }>()
const emit = defineEmits<{ notify: [text: string, ok: boolean] }>()

const tasks = useMaintenanceTaskStore()
const session = useSessionStore()
const clock = useClockStore()

const answers = ref<ChecklistAnswer[]>([])
const measures = ref('')
const materials = ref('')
const photos = ref<PhotoDraft[]>([])
const nextDue = ref('')
const note = ref('')
const description = ref('')
const createIssue = ref(false)
const busy = ref(false)

const snapshot = computed(() => props.task.snapshot)
const abnormalCount = computed(() => answers.value.filter((row) => row.result === 'abnormal').length)
const photoHint = computed(() => `已选 ${photos.value.length} 张现场照片（保存失败会保留草稿，可重试）`)
/** 执行人：计划负责人本人，或物业值班代执行（代执行必须写明原因，仓储会再校验一次） */
const owner = computed(() => snapshot.value.owner)
const isProxy = computed(() => owner.value !== '' && owner.value !== session.name)

function reset(): void {
  answers.value = tasks.answersFor(props.task.id)
  measures.value = ''
  materials.value = ''
  photos.value = []
  note.value = ''
  description.value = ''
  createIssue.value = false
  // 下次保养日期默认按周期从今天推算：先给一个合法默认值，人觉得不对可以改
  nextDue.value = nextDueDateOf(props.task.snapshot.cycle, clock.todayKey, clock.todayKey)
}

watch(() => props.task.id, reset, { immediate: true })

function setResult(row: ChecklistAnswer, result: 'ok' | 'abnormal'): void {
  answers.value = answers.value.map((item) => (item.key === row.key ? { ...item, result } : item))
}

function setNote(row: ChecklistAnswer, text: string): void {
  answers.value = answers.value.map((item) => (item.key === row.key ? { ...item, note: text } : item))
}

async function submit(): Promise<void> {
  if (busy.value) return
  /*
   * 这里只做"少跑一趟"的前置提示，真正的判定在 core/maintenance/plan.planMaintenanceExecute 里：
   * 异常必填描述、无异常不得转问题，都由仓储这一层拦，其他入口绕过界面也写不进坏数据。
   */
  if (abnormalCount.value > 0 && description.value.trim() === '') {
    emit('notify', `有 ${abnormalCount.value} 项检查结果为异常，必须写明异常描述`, false)
    return
  }
  busy.value = true
  try {
    const out = await tasks.execute(props.task.id, {
      answers: answers.value,
      measures: measures.value,
      materials: materials.value,
      nextDueDate: nextDue.value,
      note: note.value,
      photoDrafts: photos.value,
      anomaly: { createIssue: createIssue.value, note: description.value },
    })
    if (!out.ok) {
      emit('notify', out.error, false)
      return
    }
    emit('notify', `已完成保养 ${out.label}：措施与照片已写入，下次保养 ${nextDue.value}${createIssue.value ? '；异常已转问题待审核' : ''}`, true)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="execute">
    <div class="head">
      <span class="title">执行保养（{{ snapshot.planCode }}）</span>
      <span class="muted">逐项作答检查清单；必答项不作答不能提交</span>
    </div>

    <p v-if="isProxy" class="notice notice--warn">
      本计划负责人是「{{ owner || '待补充' }}」，当前身份是「{{ session.actorLabel }}」：
      非负责人提交会被仓储拦截，物业值班代执行必须在备注里写明代执行原因。
    </p>

    <div class="checklist">
      <div v-for="row in answers" :key="row.key" class="item">
        <div class="row-between item-head">
          <span>{{ row.label }}<b v-if="snapshot.checklist.find((i) => i.key === row.key)?.required"> *</b></span>
          <span class="row picks">
            <label class="pick"><input type="radio" :checked="row.result === 'ok'" @change="setResult(row, 'ok')" />正常</label>
            <label class="pick pick--bad"><input type="radio" :checked="row.result === 'abnormal'" @change="setResult(row, 'abnormal')" />异常</label>
          </span>
        </div>
        <input
          v-if="row.result === 'abnormal'"
          class="ctl"
          :value="row.note"
          placeholder="这一项的具体现象，例如 东侧固定螺栓松动约 2 mm"
          @input="setNote(row, ($event.target as HTMLInputElement).value)"
        />
      </div>
      <p v-if="answers.length === 0" class="muted">本计划快照里没有检查项，请先到计划里补充检查清单。</p>
    </div>

    <div class="grid">
      <label class="field">
        <span>维护措施 <b>*</b></span>
        <textarea v-model="measures" class="ctl" rows="2" placeholder="本次做了什么，例如 重新紧固螺栓并清洁外壳" />
        <em class="field-hint">必填：验收、复查与操作日志都要按这段措施追溯</em>
      </label>
      <label class="field">
        <span>更换材料</span>
        <textarea v-model="materials" class="ctl" rows="2" placeholder="例如 防松胶 ×1、螺栓 ×2" />
      </label>
      <label class="field">
        <span>下次保养日期 <b>*</b></span>
        <input v-model="nextDue" class="ctl" type="date" />
        <em class="field-hint">默认按计划周期从今天推算，现场可按实际情况调整；台账的"下次保养日期"取这里的登记值</em>
      </label>
      <label class="field">
        <span>备注{{ isProxy ? ' / 代执行原因' : '' }}</span>
        <textarea v-model="note" class="ctl" rows="2" placeholder="需要留档的说明" />
      </label>
    </div>

    <div class="field">
      <span>现场照片</span>
      <PhotoUploader v-model:photos="photos" :max-count="3" @error="emit('notify', $event, false)" />
      <em class="field-hint">{{ photoHint }}；照片与任务、措施、时间线、日志在同一个事务里提交</em>
    </div>

    <div class="anomaly" :class="{ 'anomaly--on': abnormalCount > 0 }">
      <div class="row-between">
        <b>异常处理</b>
        <span class="muted">本次异常 {{ abnormalCount }} 项</span>
      </div>
      <label class="field">
        <span>异常描述 <b v-if="abnormalCount > 0">*</b></span>
        <textarea v-model="description" class="ctl" rows="2" placeholder="异常现象与部位，例如 东侧固定螺栓松动，探头轻微位移" />
      </label>
      <label class="check">
        <input v-model="createIssue" type="checkbox" :disabled="abnormalCount === 0" />
        转问题处理（在问题池生成一条来源为「保养发现」的问题，待安全管理人员审核）
      </label>
      <p class="field-hint">
        保养异常只有两条路：写进本次记录留痕，或转问题处理。
        设备保养与建筑结构监测是两条独立的线，保养发现的异常只在本流程内处置。
      </p>
    </div>

    <div class="row-between foot">
      <span class="muted">提交后本周期不能再次执行（一个周期只完成一次）</span>
      <AppButton size="sm" variant="primary" :disabled="busy" @click="submit">{{ busy ? '提交中…' : '提交保养结果' }}</AppButton>
    </div>
  </div>
</template>

<style scoped>
.execute {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title {
  font-size: 13px;
  font-weight: 600;
}

.checklist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2, #f6f8f8);
  font-size: 12.5px;
}

.item-head {
  gap: 8px;
  align-items: center;
}

.item-head b {
  color: var(--state-red, #c0362c);
}

.picks {
  gap: 10px;
}

.pick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.pick--bad {
  color: var(--state-orange, #b06a00);
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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

.anomaly {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  background: var(--paper);
}

.anomaly--on {
  border-color: var(--state-orange, #b06a00);
  background: #fffaf0;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-1);
}

.foot {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.muted {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>

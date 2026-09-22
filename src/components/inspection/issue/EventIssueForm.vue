<script setup lang="ts">
/**
 * 预警事件转问题表单。
 *
 * 事件编号与位置由父级预填，不能在这里改写；真正的事件存在性和测点一致性仍由
 * issue store 在写库前读库校验。这样页面只是减少手工录入，不能伪造预警来源。
 */
import { computed, ref } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import { useIssueStore } from '@/stores/inspection/issues'
import { ANOMALY_TYPES } from '@/config/issueOptions'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{
  eventId: string
  eventNo: string
  pointId: string
  descriptionSeed: string
}>()

const emit = defineEmits<{
  done: [payload: { issueId: string; issueNo: string; duplicated: boolean }]
  cancel: []
}>()

const archive = useArchiveStore()
const issues = useIssueStore()
const anomalyType = ref('读数异常')
const description = ref(props.descriptionSeed)
const error = ref('')
const busy = ref(false)

const point = computed(() => archive.pointById(props.pointId))
const floor = computed(() => (point.value === undefined ? undefined : archive.floorById(point.value.floorId)))
const building = computed(() => (point.value === undefined ? undefined : archive.buildingById(point.value.buildingId)))
const location = computed(() => {
  if (point.value === undefined || floor.value === undefined || building.value === undefined) return '测点档案不存在'
  return `${building.value.name} ${floor.value.name}｜${point.value.zoneId}`
})

async function submit(): Promise<void> {
  if (point.value === undefined || floor.value === undefined) {
    error.value = '事件关联测点档案不存在，不能转问题处理'
    return
  }
  if (description.value.trim().length < 4) {
    error.value = '请补充现场处置说明（至少 4 个字）'
    return
  }
  error.value = ''
  busy.value = true
  try {
    const outcome = await issues.createIssueFromEvent({
      eventId: props.eventId,
      pointId: point.value.id,
      buildingId: point.value.buildingId,
      floorId: point.value.floorId,
      zoneId: point.value.zoneId,
      anomalyType: anomalyType.value,
      description: description.value.trim(),
      photos: [],
      detail: `由预警事件 ${props.eventNo} 转问题处理：${description.value.trim()}`,
    })
    emit('done', { issueId: outcome.issue.id, issueNo: outcome.issue.issueNo, duplicated: outcome.duplicated })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="event-issue-form">
    <p class="notice notice--warn">
      来源固定为预警事件 {{ eventNo }}，事件编号与测点不可在此修改；同一事件重复提交会复用已有问题，不重复建单。
    </p>
    <dl class="where">
      <div><dt>预警事件</dt><dd class="mono">{{ eventNo }}</dd></div>
      <div><dt>关联位置</dt><dd>{{ location }}</dd></div>
    </dl>
    <label class="field">
      <span>异常类型 <b>*</b></span>
      <select v-model="anomalyType" class="ctl">
        <option v-for="item in ANOMALY_TYPES" :key="item" :value="item">{{ item }}</option>
      </select>
    </label>
    <label class="field">
      <span>处置说明 <b>*</b></span>
      <textarea v-model="description" class="ctl" rows="3" placeholder="补充现场排查安排或需处理的具体事项" />
    </label>
    <p v-if="error !== ''" class="notice notice--warn">{{ error }}</p>
    <div class="row-between">
      <AppButton size="sm" :disabled="busy" @click="emit('cancel')">取消</AppButton>
      <AppButton size="sm" variant="primary" :disabled="busy" @click="submit">{{ busy ? '正在创建…' : '创建关联问题' }}</AppButton>
    </div>
  </div>
</template>

<style scoped>
.event-issue-form { display: flex; flex-direction: column; gap: 10px; }
.where { display: grid; grid-template-columns: 1fr 2fr; gap: 8px 14px; margin: 0; font-size: 12px; }
.where dt { color: var(--text-3); }
.where dd { margin: 2px 0 0; color: var(--text-1); }
.field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-2); }
.field b { color: var(--state-red, #c0362c); }
</style>

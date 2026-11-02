<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { DATASET_ID, read, command, currentEpoch } from '@/api/backend/runtime'
import { useBackendSessionStore } from '@/stores/backend/session'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
interface ShowcaseState { runId: string; phase: string; epoch: number; counts: Record<string, number>; source: string }
interface Pending { action: string; key: string; epoch: number; body: Record<string, string> }
const emit = defineEmits<{ changed: [] }>()
const session = useBackendSessionStore()
const state = ref<ShowcaseState | null>(null), message = ref(''), busy = ref(false), confirm = ref(false)
const pending = ref<Pending | null>(null)
const sensor = ref('crack'), level = ref('yellow')
const storageKey = () => `zhutong-showcase/${session.user?.id}/${DATASET_ID}`
async function load(): Promise<void> {
  if (DATASET_ID !== 'demo-showcase' || session.user?.role !== 'safety') return
  try {
    state.value = await read<ShowcaseState>('/showcase/status')
    const saved = localStorage.getItem(storageKey()); pending.value = saved ? JSON.parse(saved) as Pending : null
  } catch (cause) { message.value = (cause as Error).message }
}
async function run(action: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    if (pending.value && pending.value.action !== action) throw new Error('请先核验上一笔演示操作')
    pending.value ??= { action, key: `showcase-${crypto.randomUUID()}`, epoch: currentEpoch(),
      body: action === 'reset' ? { confirmDataset: 'demo-showcase' } : action === 'sample' ? { sensor: sensor.value, level: level.value } : {} }
    localStorage.setItem(storageKey(), JSON.stringify(pending.value))
    const result = await command<ShowcaseState>(`/showcase/${action}`, {
      body: pending.value.body, key: pending.value.key, epoch: pending.value.epoch,
    })
    if (action !== 'sample') state.value = result.data
    localStorage.removeItem(storageKey()); pending.value = null; confirm.value = false
    if (action === 'sample') await load()
    message.value = action === 'reset' ? '比赛演示集已复位，旧 App 队列会按版本隔离。' : '服务端已保存演示控制。'
    emit('changed')
  } catch (cause) { message.value = `${(cause as Error).message}；保留原请求供核验` }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <SectionCard v-if="DATASET_ID === 'demo-showcase' && session.user?.role === 'safety'" title="比赛演示 · 守护接力" sub="真实业务办理，全部硬件输入模拟；准备不会自动完成维修和验收">
    <p>状态 {{ state?.phase || '待预检' }} · 任务 {{ state?.counts.tasks ?? 0 }} · 问题 {{ state?.counts.issues ?? 0 }} · 工单 {{ state?.counts.orders ?? 0 }}</p>
    <p role="status">{{ message }}</p>
    <div class="actions">
      <AppButton v-if="pending" :disabled="busy" @click="run(pending.action)">用原请求核验上一笔操作</AppButton>
      <template v-else>
        <AppButton :disabled="busy" @click="run('prepare')">准备待办理数据</AppButton>
        <AppButton :disabled="busy" @click="run(state?.phase === 'paused' ? 'resume' : 'pause')">{{ state?.phase === 'paused' ? '继续演示' : '暂停演示' }}</AppButton>
        <AppButton :disabled="busy" @click="confirm = true">复位比赛演示集</AppButton>
      </template>
      <AppButton :disabled="busy" @click="load">刷新进度</AppButton>
    </div>
    <div v-if="!pending && state?.phase === 'ready'" class="actions">
      <select v-model="sensor" class="ctl" aria-label="模拟传感器"><option value="crack">裂缝</option><option value="tilt">倾角</option><option value="vibration">振动</option></select>
      <select v-model="level" class="ctl" aria-label="模拟等级"><option value="yellow">黄色</option><option value="orange">橙色</option><option value="red">红色</option><option value="normal">三次恢复复测</option></select>
      <AppButton :disabled="busy" @click="run('sample')">写入固定模拟样本并真实判定</AppButton>
    </div>
    <p>模拟时间按分钟推进，不伪造未来采样；正常档一次补入3条恢复复测。</p>
    <AppModal :open="confirm" title="复位专用比赛演示集？" sub="主业务集、身份与密钥不受影响。演示业务数据会清理、版本递增，旧手机队列不能写入新版本。" @close="confirm = false">
      <template #footer><AppButton @click="confirm = false">保留进度</AppButton><AppButton :disabled="busy" @click="run('reset')">确认复位</AppButton></template>
    </AppModal>
  </SectionCard>
</template>
<style scoped>
.actions { display: flex; flex-wrap: wrap; gap: 10px; }
p { line-height: 1.8; color: var(--text-muted, #617268); }
</style>

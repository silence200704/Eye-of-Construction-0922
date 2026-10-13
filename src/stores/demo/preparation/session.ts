import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { datasetResetVersion, readRegistry } from '../registry'
import type { Capability, PreparationReceipt } from '@/core/demo/preparation/types'

/** 授权只在内存中：刷新不会恢复，关问答面板不会撤销。 */
export const usePreparationSession = defineStore('demoPreparationSession', () => {
  const id = ref('')
  const epoch = ref('')
  const generation = ref(0)
  const capabilities = ref<Capability[]>([])
  const receipts = ref<PreparationReceipt[]>([])
  const reason = ref('请先从系统设置的唯一入口启动本次演示。')
  const active = computed(isCurrent)

  function isCurrent(): boolean {
    return id.value !== '' && epoch.value === readRegistry().resetAt && generation.value === datasetResetVersion.value
  }

  function end(message = '本次演示已结束；自动补齐已停止，已有数据保留。'): void {
    id.value = ''
    capabilities.value = []
    reason.value = message
  }
  function start(allowed: Capability[]): void {
    id.value = `demo_${crypto.randomUUID()}`
    epoch.value = readRegistry().resetAt
    generation.value = datasetResetVersion.value
    capabilities.value = [...allowed]
    receipts.value = []
    reason.value = allowed.length > 0 ? '本次演示允许按需补齐预设采样、视觉素材和巡检待办。' : '尚无已验证可用能力，自动补齐未开放。'
    if (allowed.length === 0) end(reason.value)
  }
  function permits(capability: Capability, token = id.value): boolean {
    return isCurrent() && token === id.value && capabilities.value.includes(capability)
  }
  function record(receipt: PreparationReceipt): void {
    receipts.value = [...receipts.value.slice(-49), receipt]
  }
  watch(datasetResetVersion, () => end('数据集已切换，自动补齐授权已撤销。'), { flush: 'sync' })
  return { id, epoch, generation, capabilities, receipts, reason, active, isCurrent, start, end, permits, record }
})

import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { datasetResetVersion } from '@/stores/demo/registry'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import type { AskLink } from '../types'

/** 当前任务的执行状态与白名单导航；停止/换库让在途动作失效。 */
export const useDirectorStore = defineStore('assistantDirector', () => {
  const active = ref(false)
  const pointId = ref('')
  const title = ref('')
  const detail = ref('')
  const progress = ref('')
  const busy = ref(false)
  const link = ref<AskLink | null>(null)
  const navigationSeq = ref(0)
  const cancelled = ref(false)
  function stop(): void {
    cancelled.value = true
    active.value = false
    link.value = null
    progress.value = '已停止自动补齐；已提交对象保留，可查看操作记录。'
    usePreparationSession().end()
  }
  function navigate(next: AskLink): void {
    if (cancelled.value) return
    link.value = next
    navigationSeq.value += 1
  }
  watch(datasetResetVersion, () => {
    active.value = false
    pointId.value = ''
    link.value = null
    cancelled.value = true
  }, { flush: 'sync' })
  return { active, pointId, title, detail, progress, busy, link, navigationSeq, cancelled, stop, navigate }
})

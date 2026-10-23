/** 导览阶段卡的读取与失效控制：与 store 解耦，避免会话文件继续膨胀。 */
import type { Ref } from 'vue'
import { buildGuidePlan, type GuidePlan } from './plan'
import { buildSnapshot, reloadGuideSources } from '../selectors'

export interface GuideRunnerInput {
  guideActive: Ref<boolean>
  guideEventId: Ref<string>
  guideCanPrepare: Ref<boolean>
  guidePlan: Ref<GuidePlan | null>
  guideLoading: Ref<boolean>
  notice: Ref<string>
}

export function createGuideRunner(input: GuideRunnerInput) {
  let sequence = 0

  /** 结束导览：让在途重读失效，避免读取完成后把旧计划写回。 */
  function end(): void {
    sequence += 1
    input.guideActive.value = false
    input.guideEventId.value = ''
    input.guideCanPrepare.value = false
    input.guidePlan.value = null
    input.guideLoading.value = false
  }

  async function reread(): Promise<void> {
    if (!input.guideActive.value) {
      input.guidePlan.value = null
      return
    }
    sequence += 1
    const current = sequence
    input.guideLoading.value = true
    try {
      await reloadGuideSources()
      const plan = buildGuidePlan(buildSnapshot(), input.guideEventId.value)
      if (current === sequence) input.guidePlan.value = plan
    } catch (cause) {
      if (current === sequence) {
        input.guidePlan.value = null
        input.notice.value = `阶段读取失败：${cause instanceof Error ? cause.message : String(cause)}`
      }
    } finally {
      if (current === sequence) input.guideLoading.value = false
    }
  }

  return { end, reread }
}

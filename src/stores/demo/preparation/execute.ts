import { nowIso } from '@/core/time'
import { inspectPreparation } from '@/core/demo/preparation/plan'
import type { Capability, PreparationPlan, PreparationReceipt } from '@/core/demo/preparation/types'
import { useArchiveStore } from '@/stores/archive'
import { useClockStore } from '@/stores/clock'
import { useRecordsStore } from '@/stores/records'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useMediaStore } from '@/stores/media'
import { usePreparationSession } from './session'
import { useDemoScenarioStore } from '../scenarios'
import { applyPreparation } from './adapters'
import { finishReceipt, preparationObjects } from './objects'
import { requireLocalDemo } from '@/api/backend/runtime'

async function inspect(request: { capability: Capability; pointId: string; requestId: string; token: string }): Promise<PreparationPlan> {
  const archive = useArchiveStore()
  const records = useRecordsStore()
  const tasks = useTaskStore()
  const plans = usePlanStore()
  await Promise.all([archive.reload(), records.reload(), tasks.reload(), plans.reload()])
  const session = usePreparationSession()
  return inspectPreparation({
    ...request, demoSessionId: request.token, datasetEpoch: session.epoch,
    authorized: session.permits(request.capability, request.token), now: nowIso(),
    point: archive.pointById(request.pointId), devices: archive.devices, records: records.records,
    tasks: tasks.tasks, frames: useMediaStore().frames,
  })
}

/** 初次全链与按需任务复用同一队列；执行时才重读计划，排队前的快照不能授权写入。 */
export async function prepareForDemo(capability: Capability, pointId: string): Promise<PreparationReceipt> {
  requireLocalDemo('演示数据准备')
  const session = usePreparationSession()
  const token = session.id
  const requestId = `prepare_${crypto.randomUUID()}`
  return useDemoScenarioStore().enqueuePreparation(async () => {
    const plan = await inspect({ capability, pointId, token, requestId })
    const receipt: PreparationReceipt = {
      requestId, demoSessionId: token, datasetEpoch: plan.datasetEpoch, capability, pointId,
      at: nowIso(), status: 'ready', created: [], reused: [], skipped: [], failed: [],
    }
    if (plan.blockedReasons.length > 0) {
      receipt.status = 'blocked'
      receipt.failed = plan.blockedReasons
      session.record(receipt)
      return receipt
    }
    const before = await preparationObjects(pointId)
    const guard = (): void => {
      if (!session.permits(capability, token)) throw new Error('本次演示已结束或数据集已切换，停止后续准备。')
    }
    try {
      guard()
      if (plan.missing.length > 0) await applyPreparation(plan, guard)
      else receipt.skipped.push('已有可用对象，未重复生成。')
      guard()
      const checked = await inspect({ capability, pointId, token, requestId })
      guard()
      if (checked.blockedReasons.length > 0 || checked.missing.length > 0) throw new Error([...checked.blockedReasons, ...checked.missing].join('；'))
      const after = await preparationObjects(pointId)
      guard()
      finishReceipt(receipt, before, after, checked.existingIds)
      receipt.reused = receipt.reused.filter((row) => !receipt.created.some((item) => item.id === row.id))
      if (receipt.created.length > 0) useClockStore().refresh()
    } catch (cause) {
      receipt.status = session.permits(capability, token) ? 'failed' : 'cancelled'
      receipt.failed.push(cause instanceof Error ? cause.message : String(cause))
      finishReceipt(receipt, before, await preparationObjects(pointId), plan.existingIds)
    }
    session.record(receipt)
    return receipt
  })
}

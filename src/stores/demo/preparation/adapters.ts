import { todayInput } from '@/core/time'
import { INSPECTION_PLAN_MARK } from '@/core/demo/preparation/policy'
import type { PreparationPlan } from '@/core/demo/preparation/types'
import { useArchiveStore } from '@/stores/archive'
import { useMediaStore } from '@/stores/media'
import { useSessionStore } from '@/stores/session'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { loadSimulatedLiveSensors } from '@/stores/writes/demo/liveSensors'
import { loadMediaEvidenceScenario } from '@/stores/writes/demo/mediaEvidence'
import { useDemoScenarioStore } from '../scenarios'
import { evidencePreparedFor } from '../evidence'

/** 适配器只用原录入、计划、任务和影像入口，绝不切演示身份或代人下结论。 */
export async function applyPreparation(plan: PreparationPlan, guard: () => void): Promise<void> {
  guard()
  if (plan.capability === 'sampling') {
    await loadSimulatedLiveSensors({ pointIds: [plan.pointId], beforeWrite: guard })
  } else if (plan.capability === 'media') {
    if (!evidencePreparedFor(plan.pointId)) {
      const out = await loadMediaEvidenceScenario({ pointId: plan.pointId })
      guard()
      if (!out.ok) throw new Error(out.message)
      await useDemoScenarioStore().rememberPreparation(out.key, out.message, false, out.anchorRefs)
    }
    guard()
    await useMediaStore().loadEvidencePair(plan.pointId, { beforeCommit: guard })
    if (useMediaStore().framesOf(plan.pointId).length < 2) throw new Error('照片读取或解码未完成，未继续视觉演示。')
  } else {
    await prepareInspection(plan.pointId, guard)
  }
}

async function prepareInspection(pointId: string, guard: () => void): Promise<void> {
  const plans = usePlanStore()
  const tasks = useTaskStore()
  const point = useArchiveStore().pointById(pointId)
  if (point === undefined) throw new Error('测点已失效。')
  const existing = plans.plans.filter((row) => row.remark === INSPECTION_PLAN_MARK && row.pointIds.length === 1 && row.pointIds[0] === pointId)
  if (existing.length > 1) throw new Error('存在多条同用途演示计划，请先人工核对。')
  let plan = existing[0]
  if (plan !== undefined && !plan.enabled) throw new Error('演示巡检计划已停用，不自动重新启用。')
  guard()
  if (plan === undefined) {
    plan = await plans.savePlan(null, {
      name: `小瞳演示待办 · ${point.code}`, kind: 'inspection', buildingId: point.buildingId,
      floorIds: [point.floorId], pointIds: [pointId], cycle: { unit: 'day', interval: 1, atTime: '00:00' },
      startDate: todayInput(), endDate: null, owner: useSessionStore().name, executorRole: 'inspector',
      checklist: [{ key: 'appearance', label: '核对墙面与传感器外观', required: true, hint: '先模拟读卡到点，再由人检查' }],
      enabled: true, remark: INSPECTION_PLAN_MARK,
    })
  }
  guard()
  const out = await tasks.generateFor(new Date(), { planId: plan.id, beforeWrite: guard })
  const pending = tasks.tasksOfPlan(plan.id).some((row) => row.results.some((result) => result.pointId === pointId && result.status === 'pending'))
  if (out.created.length === 0 && !pending) throw new Error('该演示计划今天已生成任务且已到点或检查，保留原办理结果；请到现场任务页回看。')
}

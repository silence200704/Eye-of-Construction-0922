/**
 * 巡检计划仓储。
 *
 * 计划的启用状态决定"要不要生成新任务"，停用不会删除既有任务（历史留痕）。
 * 保存前一律过 validatePlan()：楼栋、楼层、必查点的归属必须一致，
 * 否则生成出来的任务会指向别的楼栋，现场到点对不上。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { InspectionPlan } from '@/types/inspection'
import { backendActive } from '@/api/backend/runtime'
import {
  fetchInspectionPlans,
  saveInspectionPlanRemote,
  setInspectionPlanEnabledRemote,
} from '@/api/backend/field'
import { validatePlan } from '@/core/inspection/taskPlan'
import { nextPlanCode, uid } from '@/core/id'
import { nowIso } from '@/core/time'
import { toPlain } from '@/core/plain'
import { db } from '@/db/database'
import { putPlan } from '@/db/repo'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'

export interface PlanDraft {
  name: string
  kind: InspectionPlan['kind']
  buildingId: string
  floorIds: string[]
  pointIds: string[]
  cycle: InspectionPlan['cycle']
  startDate: string
  endDate: string | null
  owner: string
  executorRole: string
  checklist: InspectionPlan['checklist']
  enabled: boolean
  remark: string
}

export const usePlanStore = defineStore('inspectionPlans', () => {
  const plans = ref<InspectionPlan[]>([])
  const loaded = ref(false)

  const activePlans = computed(() => plans.value.filter((row) => row.enabled))
  const plansOfBuilding = (buildingId: string): InspectionPlan[] =>
    plans.value.filter((row) => row.buildingId === buildingId)

  async function reload(): Promise<void> {
    plans.value = backendActive() ? await fetchInspectionPlans() : await db.plans.toArray()
    loaded.value = true
  }

  function byId(id: string): InspectionPlan | undefined {
    return plans.value.find((row) => row.id === id)
  }

  /** 新建或修改计划：先校验归属，再写库并留痕。 */
  async function savePlan(id: string | null, draft: PlanDraft): Promise<InspectionPlan> {
    const archive = useArchiveStore()
    const session = useSessionStore()
    const check = validatePlan(
      { ...draft, pointIds: draft.pointIds },
      { buildings: archive.buildings, floors: archive.floors, points: archive.points },
    )
    if (!check.ok) throw new Error(check.errors.join('；'))

    const existing = id === null ? undefined : byId(id)
    if (backendActive()) {
      const saved = await saveInspectionPlanRemote(
        draft as unknown as Record<string, unknown>,
        id,
        existing?.rev,
      )
      await reload()
      return saved
    }
    const at = nowIso()
    const dayKey = at.slice(0, 10).replace(/-/g, '')
    const row: InspectionPlan = {
      id: existing?.id ?? uid('plan'),
      code: existing?.code ?? nextPlanCode(dayKey, plans.value.map((item) => item.code)),
      name: draft.name.trim(),
      kind: draft.kind,
      buildingId: draft.buildingId,
      floorIds: [...draft.floorIds],
      pointIds: [...draft.pointIds],
      cycle: { ...draft.cycle },
      startDate: draft.startDate,
      endDate: draft.endDate,
      owner: draft.owner.trim(),
      executorRole: draft.executorRole,
      checklist: draft.checklist.map((item) => ({ ...item })),
      enabled: draft.enabled,
      remark: draft.remark.trim(),
      createdAt: existing?.createdAt ?? at,
      createdBy: existing?.createdBy ?? session.name,
      updatedAt: at,
      updatedBy: session.name,
    }
    await putPlan(toPlain(row))
    await archive.log(
      existing === undefined ? 'create' : 'update',
      'system',
      row.id,
      `${row.code} ${row.name}`,
      `${existing === undefined ? '新建' : '修改'}巡检计划 ${row.code}`,
      `必查点 ${row.pointIds.length} 个；周期${
        row.cycle.unit === 'day' ? '每天' : row.cycle.unit === 'week' ? '每周' : '每月'
      } ${row.cycle.interval} 次，${row.cycle.atTime} 执行`,
    )
    await reload()
    return row
  }

  /** 启停：停用后不再生成新任务，既有任务保留。 */
  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const archive = useArchiveStore()
    const session = useSessionStore()
    const plan = byId(id)
    if (plan === undefined) return
    if (backendActive()) {
      await setInspectionPlanEnabledRemote(id, enabled, plan.rev)
      await reload()
      return
    }
    const at = nowIso()
    await putPlan(toPlain({ ...plan, enabled, updatedAt: at, updatedBy: session.name }))
    await archive.log(
      'update',
      'system',
      plan.id,
      `${plan.code} ${plan.name}`,
      `${enabled ? '启用' : '停用'}巡检计划 ${plan.code}`,
      enabled ? '启用后按周期继续生成任务' : '停用后不再生成新任务，既有任务与记录保留',
    )
    await reload()
  }

  async function reset(): Promise<void> {
    plans.value = []
    loaded.value = false
  }

  return { plans, loaded, activePlans, plansOfBuilding, byId, reload, savePlan, setEnabled, reset }
})

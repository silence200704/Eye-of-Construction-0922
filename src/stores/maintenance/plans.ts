/**
 * 保养计划仓储。
 *
 * 读取供设置页数据一致性检查、保养工作台与设备一档使用；
 * 写入（新建 / 编辑 / 启停）走受控入口：编号与审计日志在同一个 IndexedDB 事务里分配，
 * 判定用"库里那一行 + 本次提交内容"（见 core/maintenance/plan.validateMaintenancePlan）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { backendActive } from '@/api/backend/runtime'
import {
  fetchMaintenancePlans,
  saveMaintenancePlanRemote,
  setMaintenancePlanEnabledRemote,
} from '@/api/backend/field'
import { db } from '@/db/database'
import { nowIso, todayInput } from '@/core/time'
import { uid } from '@/core/id'
import { buildAuditLog } from '@/db/repo'
import { commitMaintenancePlan, commitMaintenancePlanEnabled } from '@/db/maintenance/writes'
import { validateMaintenancePlan } from '@/core/maintenance/plan'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'
import type { ChecklistItem, PlanCycle } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceResult } from '@/types/maintenance'

/** 表单提交内容（页面只负责收集，不做判定）。 */
export interface MaintenancePlanDraft {
  /** null 表示新建 */
  id: string | null
  name: string
  deviceId: string
  cycle: PlanCycle
  startDate: string
  endDate: string | null
  owner: string
  checklist: ChecklistItem[]
  remark: string
}

const EMPTY: MaintenanceResult = { ok: false, error: '', label: '', created: 0, skipped: 0 }

export const useMaintenancePlanStore = defineStore('maintenancePlans', () => {
  const plans = ref<MaintenancePlan[]>([])
  const loaded = ref(false)

  async function reload(): Promise<void> {
    plans.value = backendActive() ? await fetchMaintenancePlans() : await db.maintenancePlans.toArray()
    loaded.value = true
  }

  function byId(id: string): MaintenancePlan | undefined {
    return plans.value.find((row) => row.id === id)
  }

  /** 设备维度的计划（设备一档要用）。 */
  function plansOfDevice(deviceId: string): MaintenancePlan[] {
    return plans.value.filter((row) => row.deviceId === deviceId)
  }

  const activePlans = computed(() => plans.value.filter((row) => row.enabled))

  async function savePlanRemote(draft: MaintenancePlanDraft): Promise<MaintenanceResult> {
    const archive = useArchiveStore()
    const device = archive.deviceById(draft.deviceId)
    if (device === undefined) return { ...EMPTY, error: '所选设备不存在，请重新选择' }
    const point = device.pointId === '' ? undefined : archive.pointById(device.pointId)
    const existing = draft.id === null ? undefined : byId(draft.id)
    if (draft.id !== null && existing === undefined) return { ...EMPTY, error: '保养计划不存在' }
    try {
      const saved = await saveMaintenancePlanRemote(
        {
          name: draft.name,
          deviceId: draft.deviceId,
          buildingId: point?.buildingId ?? existing?.buildingId ?? '',
          cycle: draft.cycle,
          startDate: draft.startDate,
          endDate: draft.endDate,
          owner: draft.owner,
          checklist: draft.checklist,
          enabled: existing?.enabled ?? true,
          remark: draft.remark,
        },
        draft.id,
        existing?.rev,
      )
      await reload()
      return { ok: true, error: '', label: saved.code, created: 0, skipped: 0 }
    } catch (cause) {
      return { ...EMPTY, error: (cause as Error).message }
    }
  }

  /** 新建或编辑保养计划：设备档案只用来补全位置与编号，位置以计划为快照。 */
  async function savePlan(draft: MaintenancePlanDraft): Promise<MaintenanceResult> {
    const session = useSessionStore()
    // 计划的制定与启停收口在学校安全管理人员：计划一改，后面所有周期任务都跟着变
    if (session.role !== 'safety') return { ...EMPTY, error: '保养计划的建立与编辑由学校安全管理人员执行' }
    const check = validateMaintenancePlan({ ...draft, endDate: draft.endDate })
    if (!check.ok) return { ...EMPTY, error: check.errors.join('；') }
    if (backendActive()) return savePlanRemote(draft)
    const device = await db.devices.get(draft.deviceId)
    if (device === undefined) return { ...EMPTY, error: '所选设备不存在，请重新选择' }
    const point = (await db.points.get(device.pointId)) ?? null
    const now = nowIso()
    const existing = draft.id === null ? undefined : await db.maintenancePlans.get(draft.id)
    if (draft.id !== null && existing === undefined) return { ...EMPTY, error: '保养计划不存在' }
    const row: MaintenancePlan = {
      id: existing?.id ?? uid('mp'),
      // 编号由写入事务分配：新建时传空串，编辑时保留原编号
      code: existing?.code ?? '',
      name: draft.name.trim(),
      deviceId: device.id,
      pointId: device.pointId === '' ? null : device.pointId,
      buildingId: point?.buildingId ?? existing?.buildingId ?? '',
      cycle: { ...draft.cycle },
      startDate: draft.startDate,
      endDate: draft.endDate === null || draft.endDate.trim() === '' ? null : draft.endDate,
      owner: draft.owner,
      checklist: draft.checklist.map((item) => ({ ...item })),
      enabled: existing?.enabled ?? true,
      remark: draft.remark.trim(),
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? session.name,
      updatedAt: now,
      updatedBy: session.name,
    }
    try {
      const saved = await commitMaintenancePlan({
        plan: row,
        logs: [
          buildAuditLog({
            actor: session.name,
            actorRole: session.roleLabel,
            action: existing === undefined ? 'create' : 'update',
            objectType: 'system',
            objectId: row.id,
            objectLabel: `${existing?.code ?? '新建'} ${row.name}`,
            summary: `${existing === undefined ? '新建' : '编辑'}保养计划：${row.name}（设备 ${device.name}，负责人 ${row.owner}）`,
            reason: row.remark,
          }),
        ],
      })
      await reload()
      return { ok: true, error: '', label: saved.code, created: 0, skipped: 0 }
    } catch (cause) {
      return { ...EMPTY, error: `保存失败，未写入数据：${cause instanceof Error ? cause.message : String(cause)}（可重试）` }
    }
  }

  /** 启用 / 停用计划：停用后不再生成新任务，历史任务与台账不受影响。 */
  async function setEnabled(id: string, enabled: boolean): Promise<MaintenanceResult> {
    const session = useSessionStore()
    if (session.role !== 'safety') return { ...EMPTY, error: '保养计划的启停由学校安全管理人员执行' }
    if (backendActive()) {
      const plan = byId(id)
      if (plan === undefined) return { ...EMPTY, error: '保养计划不存在' }
      try {
        const saved = await setMaintenancePlanEnabledRemote(id, enabled, plan.rev)
        await reload()
        return { ok: true, error: '', label: saved.code, created: 0, skipped: 0 }
      } catch (cause) {
        return { ...EMPTY, error: (cause as Error).message }
      }
    }
    try {
      const result = await commitMaintenancePlanEnabled({
        planId: id,
        enabled,
        actor: { name: session.name, roleLabel: session.roleLabel },
        at: nowIso(),
      })
      if (!result.ok) return { ...EMPTY, error: result.error }
      await reload()
      return { ok: true, error: '', label: result.plan?.code ?? '', created: 0, skipped: 0 }
    } catch (cause) {
      return { ...EMPTY, error: `操作失败，数据库未变更：${cause instanceof Error ? cause.message : String(cause)}（可重试）` }
    }
  }

  /** 默认开始日期（新建表单用）：今天。 */
  function defaultStartDate(): string {
    return todayInput()
  }

  async function reset(): Promise<void> {
    plans.value = []
    loaded.value = false
  }

  return { plans, loaded, activePlans, byId, plansOfDevice, reload, savePlan, setEnabled, defaultStartDate, reset }
})

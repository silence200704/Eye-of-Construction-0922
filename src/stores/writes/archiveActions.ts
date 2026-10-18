/**
 * 归档与恢复。
 * 有历史记录的对象只归档不删除；恢复需先恢复其上级对象。
 */
import { nowIso } from '@/core/time'
import { putBuilding, putDevice, putFloor, putPoint } from '@/db/repo'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'
import { backendActive } from '@/api/backend/runtime'
import { archiveRemote } from '@/api/backend/archive'

export type ArchiveTarget = 'building' | 'floor' | 'point' | 'device'

export interface ArchiveResult {
  ok: boolean
  message: string
}

/** 归档与恢复：有历史记录的对象只归档不删除，恢复需先恢复其上级对象。 */
export async function setArchived(
  target: ArchiveTarget,
  id: string,
  archived: boolean,
  reason: string,
): Promise<ArchiveResult> {
  const store = useArchiveStore()
  const session = useSessionStore()
  const at = nowIso()
  if (archived && reason.trim() === '') {
    return { ok: false, message: '归档必须填写原因' }
  }

  const block = dependentBlock(store, target, id, archived)
  if (block !== '') return { ok: false, message: block }

  if (backendActive()) {
    const rev = target === 'building'
      ? store.buildingById(id)?.rev
      : target === 'floor'
        ? store.floorById(id)?.rev
        : target === 'point'
          ? store.pointById(id)?.rev
          : store.deviceById(id)?.rev
    try {
      await archiveRemote(target, id, archived, reason, rev)
      await store.reload()
      return { ok: true, message: archived ? '已归档' : '已恢复' }
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  const stamp = {
    status: archived ? ('archived' as const) : ('active' as const),
    archiveReason: archived ? reason : '',
    archivedAt: archived ? at : null,
    archivedBy: archived ? session.name : '',
    updatedAt: at,
    updatedBy: session.name,
  }

  if (target === 'building') {
    const row = store.buildingById(id)
    if (row === undefined) return { ok: false, message: '楼栋不存在' }
    await putBuilding({ ...row, ...stamp })
  } else if (target === 'floor') {
    const row = store.floorById(id)
    if (row === undefined) return { ok: false, message: '楼层不存在' }
    await putFloor({ ...row, ...stamp })
  } else if (target === 'point') {
    const row = store.pointById(id)
    if (row === undefined) return { ok: false, message: '测点不存在' }
    await putPoint({ ...row, ...stamp })
    if (archived) {
      const owned = store.devicesOfPoint(id)
      await Promise.all(owned.map((device) => putDevice({ ...device, ...stamp })))
    }
  } else {
    const row = store.deviceById(id)
    if (row === undefined) return { ok: false, message: '设备不存在' }
    await putDevice({ ...row, ...stamp })
  }

  const label = targetLabel(store, target, id)
  await store.log(
    archived ? 'archive' : 'restore',
    target,
    id,
    label,
    archived ? `归档${label}` : `恢复${label}`,
    reason,
  )
  await store.reload()
  return { ok: true, message: archived ? '已归档' : '已恢复' }
}

function dependentBlock(
  store: ReturnType<typeof useArchiveStore>,
  target: ArchiveTarget,
  id: string,
  archived: boolean,
): string {
  if (target === 'building') {
    if (archived && store.pointsOfBuilding(id).length > 0) {
      return '该楼栋下仍有在册测点，请先归档相关测点'
    }
    if (!archived && store.buildingById(id)?.status === 'active') return ''
  }
  if (target === 'floor') {
    if (archived && store.pointsOfFloor(id).length > 0) {
      return '该楼层下仍有在册测点，请先归档相关测点'
    }
  }
  if (target === 'point' && !archived) {
    const point = store.pointById(id)
    if (point === undefined) return '测点不存在'
    const floor = store.floorById(point.floorId)
    const building = store.buildingById(point.buildingId)
    if (floor?.status === 'archived' || building?.status === 'archived') {
      return '上级楼层或楼栋已归档，请先恢复上级对象'
    }
  }
  if (target === 'device' && !archived) {
    const device = store.deviceById(id)
    if (device !== undefined && store.pointById(device.pointId)?.status === 'archived') {
      return '所属测点已归档，请先恢复测点'
    }
  }
  return ''
}

function targetLabel(store: ReturnType<typeof useArchiveStore>, target: ArchiveTarget, id: string): string {
  if (target === 'building') {
    const row = store.buildingById(id)
    return row === undefined ? '楼栋' : `${row.code} ${row.name}`
  }
  if (target === 'floor') {
    const row = store.floorById(id)
    return row === undefined ? '楼层' : `${store.buildingName(row.buildingId)} ${row.name}`
  }
  if (target === 'point') return store.pointLabel(id)
  const row = store.deviceById(id)
  return row === undefined ? '设备' : `${row.code} ${row.name}`
}

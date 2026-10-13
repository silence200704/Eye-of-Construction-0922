/** 小瞳的 3D 讲解稿：只从已在册对象和已保存证据生成，不写库、不重算预警。 */
import type { CampusModel } from '@/core/spatial/project'
import { formatDateTime } from '@/core/time'
import { hasNumericReadings } from '@/types/catalog'
import type { AlarmEvent } from '@/types/events'
import { supportingEvidence } from '../selectors/events'
import { factsOf, latestValidRecord } from '../selectors/records'
import type { AssistantSnapshot } from '../selectors/snapshot'

export type TourStage = 'campus' | 'building' | 'floor' | 'point' | 'reading' | 'evidence'

export interface SpatialTourStep {
  stage: TourStage
  title: string
  detail: string
  buildingId: string
  floorId: string
  pointId: string
  focusPoint: boolean
}

export type SpatialTourResult =
  | { ok: true; steps: SpatialTourStep[]; pointCode: string; eventId: string | null }
  | { ok: false; reason: string }

interface TourInput {
  model: CampusModel
  snapshot: AssistantSnapshot
  pointId: string
  eventId: string
}

/** 显式事件与测点必须双向对上；多个红色事件时不替用户选一个。 */
function resolveTarget(input: TourInput): { pointId: string; event: AlarmEvent | null } | string {
  const { events } = input.snapshot
  const explicitEvent = input.eventId === '' ? null : events.find((row) => row.id === input.eventId) ?? null
  if (input.eventId !== '' && explicitEvent === null) return '指定的预警事件已不在当前数据集，请重新选定。'
  if (input.pointId !== '' && explicitEvent !== null && explicitEvent.pointId !== input.pointId) {
    return '指定的预警事件与测点不属于同一对象，讲解未启动。'
  }
  let pointId = input.pointId || explicitEvent?.pointId || ''
  if (pointId === '') {
    const red = events.filter((row) => row.status !== 'closed' && row.level === 'red')
    if (red.length > 1) return '当前有多条未关闭红色事件，请先在预警中心选定一条。'
    pointId = red[0]?.pointId ?? input.model.buildings.flatMap((b) => b.levels.flatMap((l) => l.markers))
      .find((m) => !m.archived && hasNumericReadings(m.point.metric))?.point.id ?? ''
  }
  if (pointId === '') return '当前没有可讲解的在册传感器测点。'
  const related = events.filter((row) => row.pointId === pointId && row.status !== 'closed')
  const event = explicitEvent ?? (related.length === 1 ? related[0] : null)
  return { pointId, event }
}

export function buildSpatialTour(input: TourInput): SpatialTourResult {
  const target = resolveTarget(input)
  if (typeof target === 'string') return { ok: false, reason: target }
  const marker = input.model.buildings.flatMap((building) => building.levels.map((level) => ({ building, level })))
    .find(({ level }) => level.markers.some((row) => row.point.id === target.pointId))
  if (marker === undefined) return { ok: false, reason: '测点已不在 3D 档案中，讲解未启动。' }
  const point = marker.level.markers.find((row) => row.point.id === target.pointId)
  if (point === undefined || point.archived || marker.level.floor === null || marker.building.archived) {
    return { ok: false, reason: '测点或所属楼层已归档，不能按旧位置讲解。' }
  }
  const buildingId = marker.building.building.id
  const floorId = marker.level.floor.id
  const pointId = point.point.id
  const buildingCount = input.model.buildings.filter((row) => !row.archived).length
  const location = `${marker.building.building.code} ${marker.building.building.name} · ${marker.level.name}`
  const base = { buildingId, floorId, pointId }
  const evidence = target.event === null ? null : supportingEvidence(target.event)
  const eventText = target.event === null
    ? '该测点没有唯一可确认的关联预警事件；这里不虚构红色原因。'
    : evidence === null
      ? `关联事件 ${target.event.eventNo}，但当前没有可展示的证据快照；请到预警详情核对。`
      : `事件 ${target.event.eventNo}｜证据 ${evidence.recordNo}｜采样 ${formatDateTime(evidence.sampleTime)}｜规则 ${evidence.ruleCode}（${evidence.ruleVersion}）。事件状态仍以预警详情为准。`
  const record = latestValidRecord(input.snapshot.records, pointId)
  const reading = record === null
    ? '暂无有效读数；不能据此判断设备正常。'
    : `${factsOf(record.values, point.point.metric).map((row) => `${row.value}${row.unit}`).join(' / ')}，采样 ${formatDateTime(record.sampleTime)}`
  return {
    ok: true,
    pointCode: point.point.code,
    eventId: target.event?.id ?? null,
    steps: [
      { ...base, stage: 'campus', title: '从校园看位置', detail: `${buildingCount} 栋在册建筑按 2D 校园图的档案坐标摆放；目标在 ${location}。`, focusPoint: false },
      { ...base, stage: 'building', title: '走近目标楼栋', detail: `进入 ${marker.building.building.code}；建筑外观与尺寸是档案示意，不是实测 BIM。`, focusPoint: false },
      { ...base, stage: 'floor', title: '只看目标楼层', detail: `${marker.level.name} 的区域与墙体按已有平面档案投影；未建档位置不补画。`, focusPoint: false },
      { ...base, stage: 'point', title: '聚焦墙面测点', detail: `${point.point.code} 位于${point.mount?.zoneLabel ?? '本层'}附近；墙内透视是定位示意，实际安装方式和埋深未登记。`, focusPoint: true },
      { ...base, stage: 'reading', title: '读数与时间', detail: `最近有效读数：${reading}。采样时间与录入时间请看右侧事实卡；本机没有设备心跳，不称实时在线。`, focusPoint: true },
      { ...base, stage: 'evidence', title: '核对证据与下一步', detail: `${eventText} 如需处置，请进入原预警、问题和工单表单由人完成。`, focusPoint: true },
    ],
  }
}

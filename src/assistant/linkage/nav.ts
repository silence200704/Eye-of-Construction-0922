/**
 * 「带我到 3D 看位置」的回答模板。
 *
 * 只给白名单里的只读深链（`/campus?view=3d&b=<楼栋>&f=<楼层>&point=<测点>`），
 * 不替用户跳转、不打开弹窗、不改任何数据；也不把照片区域映射成 3D 里的裂缝几何。
 */
import { buildLink, buildSpatialLink, buildSpatialTourLink } from '../actions'
import { draft, type AnswerDraft } from '../answers/shared'
import type { PointRef } from '../resolve'
import type { AssistantSnapshot } from '../selectors'
import { openEventsOfPoint } from '../selectors'
import { EVENT_LEVEL_LABEL } from '@/types/events'
import { NO_REGISTRATION_NOTE, READONLY_NAV_NOTE, SPATIAL_SCOPE_NOTE } from './notes'

export interface SpatialGoAnswerInput {
  snapshot: AssistantSnapshot
  point: PointRef
  matchNote: string
}

export function answerSpatialGo(input: SpatialGoAnswerInput): AnswerDraft {
  const { point, snapshot } = input
  const event = openEventsOfPoint(snapshot.events, point.id)[0]
  const where = `${point.buildingName} · ${point.floorName}`

  return draft(
    `${point.code} ${point.name} 在 ${where}（区域 ${point.zoneId}）。点下面「在 3D 楼层里定位该测点」，` +
      `页面会打开 3D 并逐级核对该测点确实属于这一层，然后把这个测点标出来。`,
    {
      pointId: point.id,
      facts: [
        { label: '测点', value: `${point.code} ${point.name}`, unit: '' },
        { label: '位置', value: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`, unit: '' },
        { label: '关联事件', value: event === undefined ? '当前没有未关闭事件' : `${event.eventNo}（${EVENT_LEVEL_LABEL[event.level]}）`, unit: '' },
      ],
      gaps: [
        '页面打开前会再核对一遍归属：测点已删除、已归档或不属于这一层时，页面给出原因并退回 2D，不会随便指一个位置。',
        NO_REGISTRATION_NOTE,
        READONLY_NAV_NOTE,
      ],
      links: [
        buildSpatialLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }),
        buildSpatialTourLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }, event?.id ?? ''),
        buildLink('point_building', point.buildingId),
        buildLink('point_trend', point.id),
        buildLink('media_page', point.id),
      ],
      dataNotes: [`定位口径：${input.matchNote}`, SPATIAL_SCOPE_NOTE],
    },
  )
}

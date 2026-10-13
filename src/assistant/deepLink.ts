/**
 * 助手深链的对象解析。
 *
 * 深链（`/trend?point=<测点ID>`、`/issues?workOrder=<工单ID>`）的目标必须**对着当前数据集复核**：
 * 对象被删、被归档或数据集已整体替换时，页面要显示"找不到这个对象、请重新选择"，
 * 而不是静默换成别的对象 —— 那会让人以为屏幕上这条就是链接里那条。
 *
 * 纯函数：输入是路由 query 与一个"按 ID 查对象"的回调，输出要打开的对象与失败原因。
 * 视图只负责把结果渲染成空态，不自己判断什么叫"找不到"。
 */
import type { AskLinkKind } from './types'

export interface DeepLinkTarget {
  /** 要打开的对象 ID；'' 表示没有可打开的对象 */
  id: string
  /** 非空表示要向用户说明的原因（找不到 / 已归档），界面据此显示空态 */
  reason: string
}

/** 深链参数值只认字符串；数组与 undefined 一律按"没给"处理。 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 供 `/trend?point=` 使用的测点查询结果。 */
export interface PointLookup {
  code: string
  archived: boolean
}

/**
 * `?point=<测点ID>`：只接受**在册**测点。趋势页与影像对比页共用这一条解析口径 ——
 * 两页的"找不到"写法必须一样，否则同一个链接在一个页面能开、在另一个页面报另一种错。
 * 归档测点仍然存在但不能出图/出影像，因此按"需要说明"处理。
 */
export function resolvePointTarget(value: unknown, look: (id: string) => PointLookup | undefined): DeepLinkTarget {
  const id = asText(value)
  if (id === '') return { id: '', reason: '' }
  const found = look(id)
  if (found === undefined) {
    return { id: '', reason: `找不到测点 ${id}：可能已被删除，或当前数据集已切换。请在下方选择其它测点。` }
  }
  if (found.archived) {
    return { id: '', reason: `测点 ${found.code} 已归档，影像与趋势都只按在册测点出。请在下方选择其它测点。` }
  }
  return { id, reason: '' }
}

/** 供 `/issues?workOrder=` 使用的工单查询结果。 */
export interface WorkOrderLookup {
  id: string
  /** 所属问题；工单理论上一定挂在问题下，为空时按"打不开"处理 */
  issueId: string | null
  orderNo: string
}

export interface WorkOrderTarget extends DeepLinkTarget {
  /** 命中时：该工单所属的问题 ID，界面据此打开对应详情 */
  issueId: string
}

/**
 * `/issues?workOrder=<工单ID>`。
 *
 * 注意 `workOrder=open` 是**旧的筛选值**（只看还有未验收通过工单的问题），
 * 不能被当成工单 ID；这里只处理"既不是空也不是 open"的取值。
 */
export function resolveWorkOrderTarget(value: unknown, look: (id: string) => WorkOrderLookup | undefined): WorkOrderTarget {
  const id = asText(value)
  if (id === '' || id === 'open') return { id: '', issueId: '', reason: '' }
  const found = look(id)
  if (found === undefined) {
    return { id: '', issueId: '', reason: `找不到工单 ${id}：可能已被删除，或当前数据集已切换。下表仍是全部问题。` }
  }
  if (found.issueId === null || found.issueId === '') {
    return { id: '', issueId: '', reason: `工单 ${found.orderNo} 没有关联问题，无法定位到详情。` }
  }
  return { id: found.id, issueId: found.issueId, reason: '' }
}

/** 深链参数名：与 `actions.ts` 白名单里登记的一致，改一处要改两处。 */
export const DEEP_LINK_QUERY: Partial<Record<AskLinkKind, string>> = {
  points_trend: 'points',
  point_trend: 'point',
  media_page: 'point',
  workorder_detail: 'workOrder',
}

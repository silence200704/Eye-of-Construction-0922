/**
 * 动作白名单。
 *
 * 两类动作从第一步就分开：
 * - **只读导航**：进白名单，由半屏界面按 `link` 渲染按钮后自行 `router.push`；
 *   助手不替用户跳转，页面本身也不因为一次提问发生任何状态变化。
 * - **临时演示数据**：问答只导航到系统设置，不再提供第二个写入入口。
 *
 * 链接只能由 `buildLink()` 按白名单种类生成，回答模板不许自己拼路由字符串；
 * 未登记的种类直接抛错（方案 B1：禁用任意命令执行）。
 *
 * 白名单里的深链**全部是现有页面已经在解析的参数**，逐一核对过：
 * `/alarms?event=`、`/alarms?scope=unclosed`、`/issues?issue=`、`/issues?workOrder=open`、
 * `/campus?b=`、`/archive?health=offline`、`/reports/event/:id`。
 * 页面还认不了的参数一律标 `deep: false`，宁可只到页面，也不编一个不存在的深链。
 */
import type { AskLink, AskLinkKind, AskPendingCommand } from './types'
import type { TimeRange } from '@/core/chart/range'

export interface NavSpec {
  label: string
  /** true = 目标页面已能按这个对象 ID 直接定位 */
  deep: boolean
  /** 给人看的口径说明；`deep: false` 时必须说明进去以后还要点什么 */
  note: string
  path: (objectId: string) => string
  query: (objectId: string) => Record<string, string>
}

const noQuery = (): Record<string, string> => ({})

export const NAV_WHITELIST: Record<AskLinkKind, NavSpec> = {
  points_trend: {
    label: '打开两个测点的同范围趋势', deep: true, note: '按实际两个测点和相同起止时间打开',
    path: () => '/trend', query: ids => ({ points: ids, point: ids.split(',')[0] ?? '' }),
  },
  point_building: {
    label: '在校园地图定位该测点所在楼栋',
    deep: true,
    note: '现有深链 /campus?b=<楼栋ID>，进页后定位到楼栋，测点还需在楼层图上再点一次',
    path: () => '/campus',
    query: (buildingId) => ({ b: buildingId }),
  },
  media_page: {
    label: '打开该测点的影像对比页',
    deep: true,
    note: '现有深链 /media?point=<测点ID>；页面会按测点列出会话影像，影像本身只存在当前会话里',
    path: () => '/media',
    query: (pointId) => (pointId === '' ? noQuery() : { point: pointId }),
  },
  point_trend: {
    label: '打开该测点的监测趋势',
    deep: true,
    note: '现有深链 /trend?point=<测点ID>；测点已删除或已归档时页面显示原因并让人重新选择',
    path: () => '/trend',
    query: (pointId) => (pointId === '' ? noQuery() : { point: pointId }),
  },
  spatial_3d: {
    label: '在 3D 楼层里定位该测点',
    deep: true,
    note: '现有深链 /campus?view=3d&b=<楼栋>&f=<楼层>&point=<测点>；打开前逐级核实归属，找不到或已归档时页面给原因并退回 2D',
    path: () => '/campus',
    query: noQuery,
  },
  spatial_tour: {
    label: '让小瞳带看 3D 空间',
    deep: true,
    note: '按当前测点与事件编号启动只读空间讲解；镜头与卡片变化不写入监测或处置数据',
    path: () => '/campus',
    query: noQuery,
  },
  event_detail: {
    label: '打开预警中心的事件详情',
    deep: true,
    note: '现有深链 /alarms?event=<事件ID>',
    path: () => '/alarms',
    query: (eventId) => ({ event: eventId }),
  },
  event_report: {
    label: '打开可打印的事件处置报告',
    deep: true,
    note: '现有路径参数 /reports/event/<事件ID>',
    path: (eventId) => `/reports/event/${encodeURIComponent(eventId)}`,
    query: noQuery,
  },
  issue_detail: {
    label: '打开问题详情',
    deep: true,
    note: '现有深链 /issues?issue=<问题ID>',
    path: () => '/issues',
    query: (issueId) => ({ issue: issueId }),
  },
  workorder_detail: {
    label: '打开该工单所属问题详情',
    deep: true,
    note: '现有深链 /issues?workOrder=<工单ID>，进页后展开所属问题并定位到这张工单；找不到时页面上方给出原因',
    path: () => '/issues',
    query: (orderId) => (orderId === '' ? noQuery() : { workOrder: orderId }),
  },
  alarm_queue: {
    label: '打开预警中心的未关闭队列',
    deep: true,
    note: '现有深链 /alarms?scope=unclosed',
    path: () => '/alarms',
    query: () => ({ scope: 'unclosed' }),
  },
  inspection_page: {
    label: '打开现场任务页（模拟 NFC 到点）',
    deep: true,
    note: '可按 task 定位巡检任务；先演示错码拒绝，再由人触发正确模拟读卡，模拟读卡不构成真实到场证明',
    path: () => '/inspection',
    query: (taskId) => taskId === '' ? noQuery() : { task: taskId },
  },
  // 页面级入口没有"还要再点什么"的问题，note 留空，界面据此不再重复一句废话
  campus_map: { label: '打开校园地图', deep: false, note: '', path: () => '/campus', query: noQuery },
  overview: { label: '打开校园总览', deep: false, note: '', path: () => '/', query: noQuery },
  monitor: { label: '打开监测数据页', deep: false, note: '', path: () => '/monitor', query: noQuery },
  reports: { label: '打开管理报表页', deep: false, note: '', path: () => '/reports', query: noQuery },
  settings: { label: '到系统设置载入全链演示数据', deep: false, note: '临时业务数据只从系统设置的唯一入口载入', path: () => '/settings', query: noQuery },
}

/** 白名单入口：只认登记过的种类，未登记的直接拒绝。 */
export function buildComparisonLink(ids: string[], range: TimeRange): AskLink {
  const link = buildLink('points_trend', ids.join(','))
  return { ...link, query: { ...link.query, range: range.preset, from: String(range.from), to: String(range.toExclusive) } }
}

export function buildLink(kind: AskLinkKind, objectId = ''): AskLink {
  const spec: NavSpec | undefined = NAV_WHITELIST[kind]
  if (spec === undefined) throw new Error(`未登记的动作：${String(kind)}`)
  return {
    kind,
    label: spec.label,
    path: spec.path(objectId),
    query: spec.query(objectId),
    deep: kind === 'inspection_page' && objectId === '' ? false : spec.deep,
    note: kind === 'inspection_page' && objectId === '' ? '未选定任务：进入「我的任务」后展开任务，再演示模拟读卡；不构成真实到场证明' : spec.note,
  }
}

/** 楼栋内定位（3D 用）：三个 ID 一起交给页面，缺哪个就不带哪个参数。 */
export interface SpatialLinkInput {
  buildingId: string
  floorId: string
  pointId: string
}

/**
 * 3D 定位链接：`/campus?view=3d&b=&f=&point=`。
 *
 * 与 `buildLink` 同样只认白名单里登记的种类，只是这条要三个 ID，
 * 所以单开一个入口而不是把三个 ID 拼成一个字符串。
 */
export function buildSpatialLink(input: SpatialLinkInput): AskLink {
  const spec = NAV_WHITELIST.spatial_3d
  const query: Record<string, string> = { view: '3d' }
  if (input.buildingId !== '') query.b = input.buildingId
  if (input.floorId !== '') query.f = input.floorId
  if (input.pointId !== '') query.point = input.pointId
  return { kind: 'spatial_3d', label: spec.label, path: spec.path(''), query, deep: spec.deep, note: spec.note }
}

/** 空间讲解复用同一条深链，只增加显式的演示启动标记。 */
export function buildSpatialTourLink(input: SpatialLinkInput, eventId = ''): AskLink {
  const link = buildSpatialLink(input)
  return {
    ...link,
    kind: 'spatial_tour',
    label: NAV_WHITELIST.spatial_tour.label,
    note: NAV_WHITELIST.spatial_tour.note,
    query: { ...link.query, tour: '1', ...(eventId === '' ? {} : { event: eventId }) },
  }
}

/**
 * 需要人确认的指令清单。
 *
 * 保留既有场景命令定义供历史用例核对；当前界面不渲染这些命令，
 * 临时业务数据只从系统设置的全链按钮载入。
 */
export const WRITE_COMMANDS: AskPendingCommand[] = [
  {
    id: 'prepare_red_demo',
    label: '准备一次红色预警演示数据',
    kind: 'write',
    requiresConfirmation: true,
    enabled: false,
    note: '确认后复用现有现场处置场景：补入最多 4 条历史记录，按规则形成红色待确认事件；冲突时拒绝，不预建问题或工单。',
  },
  {
    id: 'prepare_inspection_demo',
    label: '准备点检巡检演示数据（含模拟 NFC 签到）',
    kind: 'write',
    requiresConfirmation: true,
    enabled: false,
    note:
      '确认后复用现有巡检场景：建 1 条巡检计划与今日任务，并对裂缝测点做一次模拟签到；' +
      '任务按"计划@执行时刻"幂等，重复执行只提示已存在，不重复建单。',
  },
]

/** 返回副本：调用方改不动这份清单；`enabledIds` 里的指令才可点。 */
export function pendingCommands(enabledIds: string[] = []): AskPendingCommand[] {
  return WRITE_COMMANDS.map((row) => ({ ...row, enabled: enabledIds.includes(row.id) }))
}

/**
 * 按 id 取单条指令。**不要用 `pendingCommands([id])[0]` 取某一条**：
 * 这个清单是全局表，`[0]` 永远是表里第一条（红色预警），拿到的会是一条 `enabled=false`
 * 的别的指令；该旧错误已由用例固定。当前界面不再提供单场景指令按钮。
 */
export function commandFor(id: string): AskPendingCommand | undefined {
  return pendingCommands([id]).find((row) => row.id === id)
}

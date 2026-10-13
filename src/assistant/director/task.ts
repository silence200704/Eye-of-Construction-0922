import { prepareForDemo } from '@/stores/demo/preparation/execute'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { useRecordsStore } from '@/stores/records'
import { buildSnapshot, reloadGuideSources } from '../selectors'
import { askZhutong, assembleAnswer } from '../ask'
import { buildLink, buildSpatialLink } from '../actions'
import { buildGuidePlan } from '../guide/plan'
import { draft, type AnswerDraft } from '../answers/shared'
import type { AskContext, AskResult, AskStage } from '../types'
import type { PointRef } from '../resolve'
import type { Capability, PreparationReceipt } from '@/core/demo/preparation/types'
import { directorIntent, type DirectorIntent } from './intent'
import { directorTarget } from './target'
import { useDirectorStore } from './state'
import { directorReceipt } from './receipt'
import { presentMediaTask, receiptSummary } from './presentation'
import { READONLY_NAV_NOTE } from '../linkage/notes'

type Request = { question: string; context: AskContext; onStage?: (stage: AskStage) => void }

/** 编排与只读 askZhutong 分离：没有明确任务意图就原样返回 null。 */
export async function runDirector(request: Request): Promise<AskResult | null> {
  const intent = directorIntent(request.question)
  if (intent === null) return null
  const state = useDirectorStore()
  const session = usePreparationSession()
  if (intent === 'end') { state.stop(); return answer(request.question, draft(session.reason)) }
  await Promise.all([reloadGuideSources(), useRecordsStore().reload()])
  if (intent === 'receipt') return directorReceipt(request.question)
  if (intent === 'spatial') return locate(request)
  if (!session.isCurrent()) {
    if (session.id !== '') session.end('数据集已切换，自动补齐授权已撤销。')
    if (intent === 'handling') return null // 原有只读处置进度继续可用，不因准备授权缺失退化。
    return answer(request.question, draft(session.reason, { status: 'not_found', links: [buildLink('settings')] }))
  }
  const context = request.context
  const target = directorTarget(request.question, context, buildSnapshot())
  if (!('id' in target)) return answer(request.question, target)
  state.cancelled = false
  state.title = intent === 'video' ? '正在分析视频' : intent === 'media' ? '正在分析裂缝照片' : '正在执行任务'
  state.detail = `${target.code} ${target.buildingName} ${target.floorName}`
  state.busy = true
  state.progress = '已核对目标，正在检查缺项'
  try {
    if (intent === 'video') {
      const { runVideoTask } = await import('../video/task')
      return await runVideoTask(request, target)
    }
    return await play({ ...request, context }, target, intent)
  } finally {
    state.busy = false
  }
}

async function play(request: Request, point: PointRef, intent: DirectorIntent): Promise<AskResult> {
  const state = useDirectorStore()
  const effective = intent
  if (effective === 'handling') return handling(request, point)
  const capabilities: Capability[] = effective === 'media' ? ['sampling', 'media'] : effective === 'inspection' ? ['inspection'] : ['sampling']
  const receipts: PreparationReceipt[] = []
  for (const capability of capabilities) {
    state.progress = `检查并准备${capability === 'sampling' ? '当前测点采样' : capability === 'media' ? '同对象照片' : '巡检待办'}`
    const receipt = await prepareForDemo(capability, point.id)
    receipts.push(receipt)
    if (receipt.status !== 'ready' || state.cancelled) return blockedAnswer(request.question, point, receipts)
  }
  state.progress = '准备完成，已重读实际对象；正在整理证据'
  const context = samePointContext(request.context, point.id)
  const readQuestion = effective === 'media' ? `${point.code}的裂缝有什么变化？给我看数据和照片证据`
    : effective === 'inspection' ? `${point.code}怎么样` : `${point.code}怎么样`
  const queried = await askZhutong(readQuestion, { context, onStage: request.onStage })
  const result = effective === 'media' ? presentMediaTask(queried, receipts) : queried
  if (state.cancelled) return blockedAnswer(request.question, point, receipts)
  state.active = true
  state.pointId = point.id
  state.title = effective === 'inspection' ? '巡检任务已准备' : effective === 'media' ? '裂缝照片分析完成' : '监测数据已核对'
  state.detail = `${point.code} ${point.buildingName} ${point.floorName}；${receiptSummary(receipts)}。`
  state.progress = '任务完成；可继续追问当前对象'
  const link = effective === 'media' ? buildLink('media_page', point.id)
    : effective === 'inspection' ? inspectionLink(receipts)
    : effective === 'sampling' ? buildLink('point_trend', point.id)
    : buildSpatialLink({ pointId: point.id, buildingId: point.buildingId, floorId: point.floorId })
  if (effective !== 'media') state.navigate(link)
  return { ...result, question: request.question, links: [link, ...result.links.filter((row) => row.kind !== link.kind)], dataNotes: [...result.dataNotes, receiptSummary(receipts), '按需补齐已由设置页授权；预设采样不是实体设备上报，照片差异不量毫米。'] }
}

async function locate(request: Request): Promise<AskResult> {
  const snapshot = buildSnapshot()
  const point = directorTarget(request.question, request.context, snapshot)
  if (!('id' in point)) return answer(request.question, point)
  const link = buildSpatialLink({ pointId: point.id, buildingId: point.buildingId, floorId: point.floorId })
  const state = useDirectorStore()
  state.cancelled = false
  state.active = true
  state.pointId = point.id
  state.title = '正在打开3D位置'
  state.progress = '已发起同一楼栋、楼层与测点的定位'
  state.navigate(link)
  const result = await askZhutong(`在3D中定位 ${point.code}`, { context: { pointId: point.id } })
  return { ...result, question: request.question, gaps: result.gaps.filter(row => row !== READONLY_NAV_NOTE), conclusion: `已发起 ${point.code} 的3D定位：${point.buildingName} ${point.floorName}。建筑与安装位置为档案示意，具体位置请核对下方模型。` }
}

async function handling(request: Request, point: PointRef): Promise<AskResult> {
  const snapshot = buildSnapshot()
  const explicit = snapshot.events.find((row) => row.id === request.context.eventId && row.pointId === point.id)
  const open = snapshot.events.filter((row) => row.pointId === point.id && row.status !== 'closed')
  const matches = open.length > 0 ? open : snapshot.events.filter((row) => row.pointId === point.id && row.status === 'closed')
  const event = explicit ?? (matches.length === 1 ? matches[0] : undefined)
  if (event === undefined) return answer(request.question, draft(matches.length === 0 ? `${point.code}没有关联事件，小瞳不自动制造新红色预警。` : `${point.code}有多条事件，请先到预警中心选定一条再问小瞳。`, { pointId: point.id, status: 'not_found', links: [buildLink('alarm_queue')] }))
  const plan = buildGuidePlan(snapshot, event.id)
  const state = useDirectorStore()
  state.active = true
  state.pointId = point.id
  state.title = '当前处置阶段'
  state.detail = `${event.eventNo}：${plan.title}；${plan.issueNo || '尚未转问题'}；${plan.orderNo || '尚无工单'}。${plan.missing.join('；')}`
  state.progress = '已按当前数据库核对阶段；下一步由人在原表单办理'
  // 断链/多候选只打开事件核对，不猜问题或工单。
  state.navigate(plan.candidates.length === 0 && plan.gaps.length === 0 && plan.link !== null ? plan.link : buildLink('event_detail', event.id))
  return askZhutong(`这个问题处理到哪了 ${event.eventNo}`, { context: { pointId: point.id, eventId: event.id } })
}

function samePointContext(context: AskContext, pointId: string): AskContext {
  const event = buildSnapshot().events.find((row) => row.id === context.eventId && row.pointId === pointId)
  return { pointId, ...(event === undefined ? {} : { eventId: event.id }) }
}

function inspectionLink(receipts: PreparationReceipt[]) {
  const task = receipts.flatMap((row) => [...row.created, ...row.reused]).find((row) => row.kind === 'task')
  const link = buildLink('inspection_page', task?.id ?? '')
  return link
}

function blockedAnswer(question: string, point: PointRef, receipts: PreparationReceipt[]): AskResult {
  const failures = receipts.flatMap((row) => row.failed)
  const state = useDirectorStore()
  state.progress = '后续已停止，未自动跳转；已提交内容保留在操作记录'
  state.link = null
  return answer(question, draft(`未完成 ${point.code} 的任务准备。${failures.join('；')}`, {
    status: 'not_found', pointId: point.id, gaps: failures,
    dataNotes: [receiptSummary(receipts), '没有继续执行依赖失败步骤，也没有回滚或覆盖已办理数据。'],
    links: [buildLink('settings')],
  }))
}

function answer(question: string, value: AnswerDraft): AskResult {
  return assembleAnswer(question, 'demo_command', value, buildSnapshot())
}

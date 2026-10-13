import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useArchiveStore } from '@/stores/archive'
import { P_CRACK, P_TILT } from '@/db/seedFactories'
import { dayKeyOf } from '@/core/inspection/taskPlan'
import { todayInput, nowIso } from '@/core/time'
import { dayKeyOffset, demoDraft, makeDemoPhoto, withActor } from '../support'
import { reachTarget, type OrderSpec } from '../workOrder'
import { COVERAGE_NOTE } from './archive'

const NAME = '演示场景：已完成巡检与异常上报'

/** 单次历史任务，正常点与异常点都经模拟读卡和逐项提交，不把今日待操作任务变成已完成。 */
export async function prepareCompletedInspection(options: { resume?: boolean } = {}): Promise<string> {
  const plans = usePlanStore()
  const tasks = useTaskStore()
  await Promise.all([plans.reload(), tasks.reload()])
  let plan = plans.plans.find((row) => row.name === NAME)
  if (plan !== undefined) {
    const existing = tasks.tasks.find((row) => row.planId === plan?.id)
    if (existing?.status === 'checked') return existing.id
    if (!options.resume) throw new Error('已完成巡检案例存在未完成数据，未改写；请人工核对')
  }
  const day = plan?.startDate ?? dayKeyOffset(-1, todayInput())
  plan ??= await withActor('inspector', () => plans.savePlan(null, {
    name: NAME, kind: 'patrol', buildingId: 'bld_b03', floorIds: ['flr_b03_02'], pointIds: [P_CRACK, P_TILT],
    cycle: { unit: 'day', interval: 1, atTime: '09:00' }, startDate: day, endDate: day,
    owner: '周老师（巡检班组）', executorRole: 'inspector',
    checklist: [{ key: 'appearance', label: '外观是否完好', required: true, hint: '' }, { key: 'fixing', label: '固定是否牢靠', required: true, hint: '' }],
    enabled: true, remark: `${COVERAGE_NOTE} 一次性已完成巡检示例；NFC 为模拟读卡，不证明真实到场`,
  }))
  await withActor('inspector', () => tasks.generateFor(new Date(`${day}T09:00:00`), { planId: plan.id }))
  const task = tasks.tasks.find((row) => row.planId === plan.id && dayKeyOf(new Date(row.plannedAt)) === day.replace(/-/g, ''))
  if (task === undefined) throw new Error('历史巡检任务未生成')
  await withActor('inspector', async () => {
    await checkPoint(task.id, P_CRACK, false)
    await checkPoint(task.id, P_TILT, true)
  })
  if (tasks.byId(task.id)?.status !== 'checked') throw new Error('巡检尚未逐点完成')
  return task.id
}

async function checkPoint(taskId: string, pointId: string, abnormal: boolean): Promise<void> {
  const tasks = useTaskStore()
  const previous = tasks.byId(taskId)?.results.find(row => row.pointId === pointId)
  if (previous?.status === 'completed') return
  const label = useArchiveStore().pointById(pointId)?.nfc?.code
  if (label === undefined) throw new Error('巡检测点没有模拟标签')
  if (abnormal && previous?.status === 'pending') {
    const wrong = await tasks.attemptCheckIn(taskId, pointId, { labelRead: 'NFC-WRONG-DEMO', method: 'nfc', fallbackReason: '', at: nowIso() })
    if (!wrong.ok) throw new Error(wrong.error)
    if (tasks.byId(taskId)?.results.find((row) => row.pointId === pointId)?.status !== 'pending') throw new Error('错码竟然被计作到点')
  }
  if (previous?.status === 'pending') {
    const arrived = await tasks.attemptCheckIn(taskId, pointId, { labelRead: label, method: 'nfc', fallbackReason: '', at: nowIso() })
    if (!arrived.ok) throw new Error(arrived.error)
  }
  let issueId: string | null = previous?.issueIds[0] ?? null
  if (abnormal && !issueId) {
    const file = await makeDemoPhoto('巡检固定件检查示意', 185)
    const photoDrafts = file === null ? [] : [await demoDraft(`demo-${taskId}-scene`, file)]
    const result = await tasks.reportInspectionIssue(taskId, pointId, { anomalyType: '探头支架松动', description: `${COVERAGE_NOTE} 巡检发现倾角探头固定件松动，需设备维修核对；模拟巡检检查结果。`, photoDrafts })
    if (!result.ok || result.issue === null) throw new Error(result.error)
    issueId = result.issue.id
  }
  const done = await tasks.completePointCheck(taskId, pointId, {
    answers: [{ key: 'appearance', label: '外观是否完好', result: 'ok', note: '模拟检查：外观完好' }, { key: 'fixing', label: '固定是否牢靠', result: abnormal ? 'abnormal' : 'ok', note: abnormal ? '模拟检查：固定件松动，已上报问题' : '' }],
    linkedIssueId: issueId, noIssueReason: '',
  })
  if (!done.ok) throw new Error(done.error)
}

export async function prepareAssignedOrder(): Promise<string> {
  const issues = useIssueStore()
  const orders = useWorkOrderStore()
  await Promise.all([issues.reload(), orders.reload()])
  const tag = `${COVERAGE_NOTE} 已派工待接单`
  const existing = issues.issues.find((row) => row.description.startsWith(tag))
  if (existing !== undefined) {
    const order = orders.ordersOfIssue(existing.id)[0]
    if (order === undefined) throw new Error('待接单案例已有问题但缺工单，未擅自修改')
    return order.id
  }
  const spec: OrderSpec = { tag: '已派工待接单', pointId: 'pnt_b02_f1_check01', buildingId: 'bld_b02', floorId: 'flr_b02_01', zoneId: '一层走廊', anomalyType: '门把手松动', summary: '已派维修人员处理，尚未接单。', target: 'assigned' }
  const result = await withActor('safety', () => issues.reportManualIssue({ ...spec, description: `${tag}：${spec.summary}`, photos: [], detail: '预设状态样例，由原业务审核与派工入口生成' }))
  const reviewed = await withActor('safety', () => issues.reviewIssue(result.issue.id, { action: 'to_repair', category: 'general', note: '门把手固定松动，安排维修' }))
  if (!reviewed.ok) throw new Error(reviewed.error)
  await orders.reload()
  const order = orders.ordersOfIssue(result.issue.id)[0]
  if (order === undefined) throw new Error('待接单案例未生成工单')
  const failure = await reachTarget(spec, order.id)
  if (failure !== '') throw new Error(failure)
  return order.id
}

import type { Device, MonitorRecord, Point } from '@/types/domain'
import type { InspectionTask } from '@/types/inspection'
import type { MediaFrame } from '@/types/media'
import { dayKeyOf } from '@/core/inspection/taskPlan'
import { permitsTarget, PREPARATION_TARGETS, SAMPLE_WINDOW_MS } from './policy'
import type { Capability, PreparationPlan } from './types'

export interface PreparationInput {
  requestId: string
  demoSessionId: string
  datasetEpoch: string
  authorized: boolean
  capability: Capability
  pointId: string
  now: string
  point?: Point
  devices: Device[]
  records: MonitorRecord[]
  tasks: InspectionTask[]
  frames: MediaFrame[]
}

/** 不写库、不建档，不把登记成功等同于本次对象可用。 */
export function inspectPreparation(input: PreparationInput): PreparationPlan {
  const plan: PreparationPlan = {
    requestId: input.requestId, demoSessionId: input.demoSessionId, datasetEpoch: input.datasetEpoch,
    capability: input.capability, pointId: input.pointId, existingIds: [], missing: [],
    steps: ['检查目标', '补齐缺项', '核验结果'],
    limits: { records: 4, plans: 1, tasks: 1, frames: 2 }, blockedReasons: [],
  }
  if (!input.authorized) plan.blockedReasons.push('本次演示未开启或已失效，请到系统设置的唯一入口重新启动。')
  const target = PREPARATION_TARGETS.find((row) => row.id === input.pointId)
  if (!permitsTarget(input.capability, input.pointId)) plan.blockedReasons.push('这个测点没有登记该能力的演示素材，不自动编造数据。')
  if (input.point?.status !== 'active' || input.point.code !== target?.code || input.point.metric !== target?.metric) {
    plan.blockedReasons.push('目标测点不存在、已归档或档案与演示登记不一致。')
  }
  if (input.capability === 'sampling') inspectSampling(input, plan)
  if (input.capability === 'media') inspectMedia(input, plan)
  if (input.capability === 'inspection') inspectTasks(input, plan)
  return plan
}

function inspectSampling(input: PreparationInput, plan: PreparationPlan): void {
  const target = PREPARATION_TARGETS.find((row) => row.id === input.pointId)
  if (!input.devices.some((row) => row.id === target?.deviceId && row.pointId === input.pointId && row.status === 'active')) {
    plan.blockedReasons.push('登记设备缺失、已归档或与测点归属不一致。')
  }
  const rows = input.records.filter((row) => row.pointId === input.pointId).sort((a, b) => b.sampleTime.localeCompare(a.sampleTime))
  const latest = rows[0]
  const gap = latest === undefined ? Infinity : Date.parse(input.now) - Date.parse(latest.sampleTime)
  if (latest !== undefined && (!Number.isFinite(gap) || gap < 0)) {
    plan.blockedReasons.push('最新采样时间无效或晚于现在，请先核对记录。')
  } else if (latest !== undefined && gap < SAMPLE_WINDOW_MS) {
    if (latest.quality !== 'valid') plan.blockedReasons.push('近期最新记录质量存疑或无效，不能用演示采样盖过它。')
    else plan.existingIds = rows.filter((row) => row.quality === 'valid' && Date.parse(input.now) - Date.parse(row.sampleTime) < SAMPLE_WINDOW_MS).map((row) => row.id)
  } else if (latest !== undefined && (latest.quality !== 'valid' || latest.source !== 'device' || latest.revision > 0)) {
    plan.blockedReasons.push('最新记录属于人工/导入/修订或质量异常，保留原值；请先人工核对，不自动追加演示值。')
  } else plan.missing.push('当前测点缺少近30分钟有效采样，最多追加4条预设记录。')
}

function inspectMedia(input: PreparationInput, plan: PreparationPlan): void {
  const frames = input.frames.filter((row) => row.pointId === input.pointId)
  const comparable = frames.filter((row) => row.origin !== 'demo_public')
  if (comparable.length >= 2) plan.existingIds = comparable.map((row) => row.id)
  else if (frames.length !== 0) plan.blockedReasons.push('已有单张或公开参考影像；请先人工选择同位置照片，不自动替换或配对。')
  else plan.missing.push('读取登记的公开实拍派生照片对，仅存本次页面会话。')
}

function inspectTasks(input: PreparationInput, plan: PreparationPlan): void {
  const day = dayKeyOf(new Date(input.now))
  const rows = input.tasks.filter((task) => dayKeyOf(new Date(task.plannedAt)) === day
    && task.results.some((row) => row.pointId === input.pointId && row.status === 'pending'))
  if (rows.length > 1) plan.blockedReasons.push('今天有多条可用任务，请在现场任务页选定，不替你挑第一条。')
  else if (rows.length === 1) plan.existingIds = [rows[0].id]
  else plan.missing.push('创建仅包含当前测点的巡检待办；签到和检查结果由人操作。')
}

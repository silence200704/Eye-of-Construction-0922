/**
 * 模拟 NFC 到点的导览（只读推导）。
 *
 * 只回答三件事：进哪个页、哪条任务、哪几个点位，以及"先错码被拒、再正确码到点"的顺序。
 * **不代替人工提交**：到点与否由现场任务页的仓储判定，导览只把人和顺序带到位。
 * 缺数据时给出"该演示场景会创建什么"，由人确认后走既有场景入口，不在导览里写库。
 */
import type { InspectionTask } from '@/types/inspection'
import { roleName } from '@/types/catalog'
import { nfcLabelOf as nfcLabel } from '@/core/id'

/** 任务的只读投影：够定位任务与点位，不带清单答案等业务明细。 */
export interface TaskRef {
  id: string
  taskNo: string
  planCode: string
  planName: string
  buildingId: string
  plannedAt: string
  dueAt: string
  status: string
  executorRole: string
  points: { pointId: string; status: string; attempts: number }[]
}

export interface NfcGuide {
  /** 有没有可直接用的演示任务与待检查点位 */
  ready: boolean
  taskNo: string
  planCode: string
  executorRole: string
  /** 建议先演示"错码被拒"的点位（仍待检查的那个） */
  pointCode: string
  pointName: string
  /** 已经到过点的点位（用来讲"错码不计入到点、正确码才推进"） */
  arrivedPointCodes: string[]
  /** 按顺序要做的动作；到点结论始终由现场任务页判定 */
  steps: string[]
  /** 没有可用任务时：提示去唯一的全链载入入口 */
  confirmRequired: boolean
  /** 需要确认时，说明该场景会写入什么（不写库，只描述） */
  prepareNote: string
  note: string
}

const SCENARIO_NOTE =
  '系统设置里的「一键载入全链演示数据」会准备巡检计划与任务，并对裂缝测点做一次模拟签到；' +
  '读取仍由现场任务页按标签编号核对，导览不写数据。'

/**
 * 导览只需要两样东西：任务列表与测点档案（拿编号/名称）。
 * 刻意收窄成这个形状，避免依赖整份快照 —— 也让"空数据"这类默认值好写。
 */
export interface NfcInput {
  tasks: TaskRef[]
  points: { id: string; code: string; name: string }[]
}

/** 投影：巡检任务取"还能继续演示"的那条（有未到点点位优先）。 */
export function nfcGuideOf(input: NfcInput, event: { pointId: string } | null): NfcGuide {
  const ready = pickTask(input.tasks)
  if (ready === null) {
    return {
      ready: false,
      taskNo: '',
      planCode: '',
      executorRole: '巡检人员',
      pointCode: '',
      pointName: '',
      arrivedPointCodes: [],
      steps: ['先到系统设置一键载入全链演示数据', '到现场任务页用「我的任务」展开任务', '先输错码被拒，再模拟正确码到点'],
      confirmRequired: true,
      prepareNote: SCENARIO_NOTE,
      note: '当前没有可用的巡检任务：导览不会凭空造任务，也不会替人签到。',
    }
  }
  const results = ready.task.results
  const notArrived = results.filter((row) => row.status !== 'completed' && row.status !== 'arrived')
  const arrived = results.filter((row) => row.status === 'arrived')
  // 优先讲"当前事件那个测点"，它不在本任务里时才退到第一个未到点点位
  const target =
    notArrived.find((row) => row.pointId === event?.pointId) ??
    notArrived[0] ??
    results.find((row) => row.status !== 'completed') ??
    null
  const point = target === null ? undefined : input.points.find((row) => row.id === target.pointId)
  const steps = [
    `打开现场任务页，用「我的任务」展开 ${ready.task.taskNo}`,
    target === null ? '本任务各点位都已到点：可讲解尝试历史里的失败留痕' : `先在 ${point?.code ?? target.pointId} 输一个**错号**：应被拒绝且不计入到点`,
    target === null ? '需要新点位时到系统设置载入全链演示数据' : `再用正确标签 ${nfcLabelOf(point?.code ?? '')} 模拟读卡 → 提交到点`,
    '到点后仍可在该点位继续完成检查清单（到点不等于检查完成）',
  ]
  return {
    ready: true,
    taskNo: ready.task.taskNo,
    planCode: ready.task.planCode,
    executorRole: ready.task.executorRole,
    pointCode: point?.code ?? '',
    pointName: point?.name ?? '',
    arrivedPointCodes: arrived.map((row) => input.points.find((p) => p.id === row.pointId)?.code ?? row.pointId),
    steps,
    confirmRequired: false,
    prepareNote: '',
    note:
      'NFC 为**模拟读卡**（编号由页面带入或人工输入），不构成真实到场证明；' +
      `当前身份需为「${roleName(ready.task.executorRole)}」才能操作该任务。`,
  }
}

interface ReadyTask {
  task: { id: string; taskNo: string; planCode: string; executorRole: string; results: { pointId: string; status: string; attempts: number }[] }
}

/** 选任务：跳过已完成/全部到点的，优先还有待检查点位的；同样条件下取更早的计划时刻。 */
function pickTask(tasks: TaskRef[]): ReadyTask | null {
  const usable = tasks
    .filter((row) => row.status !== 'done')
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
  const withPending = usable.find((row) => row.points.some((point) => point.status !== 'completed' && point.status !== 'arrived'))
  const chosen = withPending ?? usable[0]
  if (chosen === undefined) return null
  return {
    task: {
      id: chosen.id,
      taskNo: chosen.taskNo,
      planCode: chosen.planCode,
      executorRole: chosen.executorRole,
      results: chosen.points,
    },
  }
}

/** 标签编号口径复用 `core/id.nfcLabelOf`；测点编号缺失时不编造标签号。 */
function nfcLabelOf(pointCode: string): string {
  return pointCode === '' ? '（页面带入的标签号）' : nfcLabel(pointCode)
}

/** 任务投影（从领域类型挑字段），供快照与测试共用。 */
export function taskRefOf(row: InspectionTask, planName: string, planCode: string): TaskRef {
  return {
    id: row.id,
    taskNo: row.taskNo,
    planCode,
    planName,
    buildingId: row.planSnapshot.buildingId,
    plannedAt: row.plannedAt,
    dueAt: row.dueAt,
    status: row.status,
    executorRole: row.planSnapshot.executorRole,
    points: row.results.map((result) => ({
      pointId: result.pointId,
      status: result.status,
      attempts: result.attempts.length,
    })),
  }
}

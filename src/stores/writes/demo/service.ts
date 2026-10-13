/**
 * 巡检、保养与报表场景。
 *
 * 巡检走 `plans.savePlan` → `tasks.generateFor` → `tasks.attemptCheckIn`；
 * 保养走 `maintenancePlans.savePlan` → `maintenanceTasks.generateForDay` → `maintenanceTasks.execute`；
 * 报表场景不写数据，只把口径与出口演示到位。
 */
import type { ChecklistAnswer, ChecklistItem } from '@/types/inspection'
import { nowIso, todayInput } from '@/core/time'
import { dayKeyOf } from '@/core/inspection/taskPlan'
import { P_CRACK, P_TH, P_TILT, P_VIB } from '@/db/seedFactories'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import {
  dayKeyOffset,
  demoDraft,
  logScenario,
  makeDemoPhoto,
  makeResult,
  withActor,
  type DemoScenarioResult,
} from './support'

const INSPECT_PLAN_NAME = '演示场景：3 号教学楼二层日常巡检'
const CHECKLIST: ChecklistItem[] = [
  { key: 'appearance', label: '外观是否完好', required: true, hint: '有无破损、锈蚀、遮挡' },
  { key: 'fixing', label: '固定是否牢靠', required: true, hint: '探头、支架、线缆是否松动' },
  { key: 'label', label: '标签是否可读', required: false, hint: 'NFC 标签与编号是否清晰' },
]

/** 巡检场景：建计划 → 生成今日任务 → 对裂缝测点做一次模拟签到。 */
export async function loadInspectionScenario(): Promise<DemoScenarioResult> {
  const key = 'inspection' as const
  const plans = usePlanStore()
  const tasks = useTaskStore()
  await plans.reload()
  await tasks.reload()
  const notes: string[] = []
  let created = 0
  let skipped = 0

  let plan = plans.plans.find((row) => row.name === INSPECT_PLAN_NAME)
  if (plan === undefined) {
    plan = await withActor('inspector', async () =>
      plans.savePlan(null, {
        name: INSPECT_PLAN_NAME,
        kind: 'patrol',
        buildingId: 'bld_b03',
        floorIds: ['flr_b03_02'],
        pointIds: [P_CRACK, P_TILT, P_VIB, P_TH],
        cycle: { unit: 'day', interval: 1, atTime: '09:00' },
        startDate: todayInput(),
        endDate: null,
        owner: '周老师（巡检班组）',
        executorRole: 'inspector',
        checklist: CHECKLIST,
        enabled: true,
        remark: '演示场景导入：覆盖 3 号教学楼二层的四个传感器测点',
      }),
    )
    created += 1
    notes.push(`计划 ${plan.code}`)
  } else {
    skipped += 1
    notes.push(`计划已存在 ${plan.code}`)
  }

  const generated = await withActor('inspector', async () => tasks.generateFor(new Date()))
  await tasks.reload()
  notes.push(`任务新生成 ${generated.created.length} 条、已存在 ${generated.skipped} 条`)

  const today = dayKeyOf(new Date())
  const task = tasks.tasks.find((row) => row.planId === plan.id && dayKeyOf(new Date(row.plannedAt)) === today)
  if (task === undefined) {
    notes.push('今日任务未生成')
  } else {
    const result = task.results.find((row) => row.pointId === P_CRACK)
    if (result === undefined || result.status === 'pending') {
      const attempt = await withActor('inspector', async () =>
        tasks.attemptCheckIn(task.id, P_CRACK, {
          labelRead: 'NFC-B03-F2-CRACK01',
          method: 'nfc',
          fallbackReason: '',
          at: nowIso(),
        }),
      )
      notes.push(attempt.ok ? `已签到 ${task.taskNo}｜B03-F2-CRACK01` : `签到被拒（${attempt.error}）`)
      if (attempt.ok) created += 1
    } else {
      skipped += 1
      notes.push(`B03-F2-CRACK01 已到点（${result.status}）`)
    }
  }

  await tasks.reload()
  const current = task === undefined ? undefined : tasks.byId(task.id)
  const arrived = current?.results.filter((row) => row.status === 'arrived').length ?? 0
  const completed = current?.results.filter((row) => row.status === 'completed').length ?? 0
  const message = `巡检：${notes.join('；')}；今日任务 ${current?.taskNo ?? '未生成'}，${current?.results.length ?? 0} 个必查点中 ${arrived} 个已到点待检查、${completed} 个已完成`
  await logScenario(key, '点检巡检（含 NFC 模拟签到）', message)
  return makeResult(key, current !== undefined, message, {
    created,
    skipped,
    anchors: task === undefined ? [] : [task.taskNo],
    anchorRefs: task === undefined ? [] : [{ kind: 'inspectionTask' as const, id: task.id }],
  })
}

const MAINTAIN_PLAN_NAME = '演示场景：裂缝位移探头周期保养'
const MAINTAIN_CHECKLIST: ChecklistItem[] = [
  { key: 'surface', label: '外观与基面是否完好', required: true, hint: '有无破损、积尘、脱胶' },
  { key: 'fixing', label: '探头与线缆固定是否牢靠', required: true, hint: '有无松动、拉扯' },
  { key: 'reading', label: '读数与基准比对是否正常', required: true, hint: '偏差是否在合理范围' },
]

function answersOf(checklist: ChecklistItem[], abnormalKey = ''): ChecklistAnswer[] {
  return checklist.map((item) => ({
    key: item.key,
    label: item.label,
    result: item.key === abnormalKey ? 'abnormal' : 'ok',
    note: item.key === abnormalKey ? '读数与基准偏差偏大，需进一步核对' : '',
  }))
}

/** 保养场景：一条计划 + 今日待执行 / 已完成 / 已逾期 / 异常转问题。 */
export async function loadMaintenanceScenario(): Promise<DemoScenarioResult> {
  const key = 'maintenance' as const
  const plans = useMaintenancePlanStore()
  const tasks = useMaintenanceTaskStore()
  await plans.reload()
  await tasks.reload()
  const notes: string[] = []
  let created = 0
  let skipped = 0

  let plan = plans.plans.find((row) => row.name === MAINTAIN_PLAN_NAME)
  if (plan === undefined) {
    const saved = await withActor('safety', async () =>
      plans.savePlan({
        id: null,
        name: MAINTAIN_PLAN_NAME,
        deviceId: 'dev_b03_f2_crack01',
        cycle: { unit: 'day', interval: 1, atTime: '09:00' },
        startDate: dayKeyOffset(-7, todayInput()),
        endDate: null,
        owner: '李老师（后勤保障处）',
        checklist: MAINTAIN_CHECKLIST,
        remark: '演示场景导入：裂缝位移探头的周期保养',
      }),
    )
    if (!saved.ok) return makeResult(key, false, `保养计划未建立：${saved.error}`)
    await plans.reload()
    plan = plans.plans.find((row) => row.name === MAINTAIN_PLAN_NAME)
    created += 1
  }
  if (plan === undefined) return makeResult(key, false, '保养计划未建立（未找到刚写入的计划）')
  notes.push(`计划 ${plan.code}`)

  const days = [
    { offset: 0, exec: 'none' as const },
    { offset: -1, exec: 'normal' as const },
    { offset: -2, exec: 'abnormal' as const },
    { offset: -3, exec: 'none' as const },
  ]
  for (const day of days) {
    const dayKey = dayKeyOffset(day.offset, todayInput())
    const generated = await withActor('safety', async () => tasks.generateForDay(dayKey))
    if (generated.created > 0) created += generated.created
    else skipped += 1
    if (day.exec === 'none') continue
    await tasks.reload()
    const task = tasks.tasks.find((row) => row.planId === plan?.id && row.plannedAt.slice(0, 10) === dayKey)
    if (task === undefined || task.status === 'done') {
      skipped += 1
      continue
    }
    const outcome = await executeTask(task.id, day.exec)
    notes.push(`${dayKey}：${outcome}`)
  }

  await tasks.reload()
  const pending = tasks.tasks.filter((row) => row.status !== 'done').length
  const todayTask = tasks.tasks.find((row) => row.planId === plan?.id && row.status !== 'done')
  const message =
    `保养：${notes.join('；')}；任务合计 ${tasks.tasks.length} 条，其中未完成 ${pending} 条（今日待执行 + 逾期）`
  await logScenario(key, '设备保养（台账 / 日历 / 逾期 / 异常转问题）', message)
  return makeResult(key, true, message, {
    created,
    skipped,
    anchors: [plan.code],
    anchorRefs: [
      { kind: 'maintenancePlan', id: plan.id },
      ...(todayTask === undefined ? [] : [{ kind: 'maintenanceTask' as const, id: todayTask.id }]),
    ],
    ...(todayTask === undefined ? {} : { focus: { path: '/maintenance', query: { task: todayTask.id } } }),
  })
}

/** 执行一条保养任务；异常项按剧本决定是否转问题。 */
export async function executeTask(taskId: string, mode: 'normal' | 'abnormal'): Promise<string> {
  const tasks = useMaintenanceTaskStore()
  const file = await makeDemoPhoto('保养现场', 96)
  const drafts = file === null ? [] : [await demoDraft(`demo-${taskId}-scene`, file)]
  const out = await withActor('safety', async () =>
    tasks.execute(taskId, {
      answers: answersOf(MAINTAIN_CHECKLIST, mode === 'abnormal' ? 'reading' : ''),
      measures: '清洁探头与基面，重新固定线缆并复核读数',
      materials: '无水乙醇 1 瓶、扎带 4 根',
      nextDueDate: dayKeyOffset(7, todayInput()),
      note: '按周期保养规程执行',
      photoDrafts: drafts,
      anomaly:
        mode === 'abnormal'
          ? { createIssue: true, note: '读数与基准偏差偏大，疑似探头松动，转问题跟踪' }
          : { createIssue: false, note: '' },
    }),
  )
  return out.ok ? `已执行（${mode === 'abnormal' ? '异常转问题' : '正常'}）` : `执行被拒（${out.error}）`
}

/** 报表场景：不写数据，读当前库里的条数并提示怎么演示四类出口。 */
export async function loadReportsScenario(): Promise<DemoScenarioResult> {
  const key = 'reports' as const
  const events = useEventsStore()
  const issues = useIssueStore()
  const orders = useWorkOrderStore()
  const tasks = useMaintenanceTaskStore()
  await Promise.all([events.reload(), issues.reload(), orders.reload(), tasks.reload()])
  const message =
    `当前库：预警事件 ${events.sorted.length} · 问题 ${issues.issues.length} · 工单 ${orders.orders.length} · 保养任务 ${tasks.tasks.length}；` +
    '把时间范围切到 2025-01-01 ~ 2025-01-31 可看「暂无数据」写法，四张明细表各有独立导出，事件行可打开处置报告'
  await logScenario(key, '管理报表（指标 / 暂无数据 / 导出 / 处置报告）', message)
  return makeResult(key, true, message)
}

/**
 * 问题池与复查场景。
 *
 * 问题池场景把**六类审核出口**各走一遍；复查场景对三条待复查问题各给一种结论。
 * 出口与结论的判定都在 `core/`，这里只按剧本提交输入，不写状态结果。
 */
import type { InspectionIssue } from '@/types/inspection'
import type { ReviewPayload } from '@/stores/inspection/issues'
import { todayInput } from '@/core/time'
import { useIssueStore } from '@/stores/inspection/issues'
import { dayKeyOffset, logScenario, makeResult, withActor, type DemoScenarioResult } from './support'

/** 演示标记：写进问题描述，既用于幂等查找，也让演示数据在界面上可辨认。 */
function tagText(tag: string): string {
  return `演示场景[${tag}]`
}

interface IssueSpec {
  tag: string
  pointId: string
  buildingId: string
  floorId: string
  zoneId: string
  anomalyType: string
  summary: string
  review: Omit<ReviewPayload, 'duplicateOf'>
}

/**
 * 六个出口各一条问题。
 * 审核意见长度按规则给足：一般出口 ≥4 字，"退回补充 / 转专业排查 / 无需处理" ≥10 字。
 */
const POOL_SPECS: IssueSpec[] = [
  {
    tag: '问题池·转维修',
    pointId: 'pnt_b01_f1_check01',
    buildingId: 'bld_b01',
    floorId: 'flr_b01_01',
    zoneId: '一层走廊',
    anomalyType: '设备故障',
    summary: '一层走廊应急指示灯不亮，现场确认灯珠与镇流器均无响应。',
    review: { action: 'to_repair', category: 'equipment', note: '设备故障，转维修工单处理' },
  },
  {
    tag: '问题池·转排查',
    pointId: 'pnt_b02_f1_check01',
    buildingId: 'bld_b02',
    floorId: 'flr_b02_01',
    zoneId: '一层走廊',
    anomalyType: '裂缝',
    summary: '一层走廊门洞上方发现斜向裂缝，长度约 40 cm，需专业判定成因。',
    review: { action: 'to_investigate', category: 'crack', note: '疑似结构裂缝，需要转专业排查确认成因' },
  },
  {
    tag: '问题池·安排复查',
    pointId: 'pnt_b03_f1_check01',
    buildingId: 'bld_b03',
    floorId: 'flr_b03_01',
    zoneId: '一层走廊',
    anomalyType: '渗漏',
    summary: '一层走廊顶棚局部返潮泛黄，未确认是管线渗漏还是冷凝水。',
    review: { action: 'recheck', category: 'unclear', note: '情况不明，安排复查' },
  },
  {
    tag: '问题池·退回补充',
    pointId: 'pnt_b04_f1_check01',
    buildingId: 'bld_b04',
    floorId: 'flr_b04_01',
    zoneId: '一层主馆区',
    anomalyType: '外观破损',
    summary: '主馆区看台边缘饰面有破损，上报时未附整体照片，无法判断范围。',
    review: { action: 'need_evidence', category: 'image', note: '照片不足，请补充破损范围与位置的照片后再审' },
  },
  {
    tag: '问题池·关联既有',
    pointId: 'pnt_b01_f1_check01',
    buildingId: 'bld_b01',
    floorId: 'flr_b01_01',
    zoneId: '一层走廊',
    anomalyType: '构件松动',
    summary: '一层走廊扶手连接件有松动迹象，疑似与既有设备故障位置重叠。',
    review: { action: 'link_object', category: 'issue', note: '与既有问题重复，关联处理' },
  },
  {
    tag: '问题池·无需处理',
    pointId: 'pnt_b02_f1_check01',
    buildingId: 'bld_b02',
    floorId: 'flr_b02_01',
    zoneId: '一层走廊',
    anomalyType: '读数异常',
    summary: '现场读数与历史偏差较大，怀疑是读数时未按规程静置。',
    review: { action: 'close_no_fault', category: 'false_alarm', note: '现场核查未发现异常，判定为误报，无需处理' },
  },
]

/** 按演示标记找已建的问题：人工上报的"十分钟时间桶"不足以做跨会话幂等。 */
function findIssue(tag: string): InspectionIssue | undefined {
  const issues = useIssueStore()
  const text = tagText(tag)
  return issues.issues.find((row) => row.description.includes(text))
}

async function ensureIssue(spec: IssueSpec): Promise<InspectionIssue | null> {
  const found = findIssue(spec.tag)
  if (found !== undefined) return found
  const issues = useIssueStore()
  const out = await issues.reportManualIssue({
    pointId: spec.pointId,
    buildingId: spec.buildingId,
    floorId: spec.floorId,
    zoneId: spec.zoneId,
    anomalyType: spec.anomalyType,
    description: `${tagText(spec.tag)} ${spec.summary}`,
    photos: [],
    detail: `演示场景导入：${spec.summary}`,
  })
  return out.issue
}

/** 需要"关联既有问题"的出口要指向一条真实存在的未关闭问题。 */
function linkTarget(tag: string): string | undefined {
  const issues = useIssueStore()
  return issues.issues.find((row) => row.description.includes(tagText(tag)) && row.status !== 'closed')?.id
}

/** 问题池：六类审核出口各走一遍。 */
export async function loadIssuePoolScenario(): Promise<DemoScenarioResult> {
  const key = 'issuePool' as const
  const issues = useIssueStore()
  await issues.reload()
  const notes: string[] = []
  let created = 0
  let skipped = 0

  await withActor('safety', async () => {
    for (const spec of POOL_SPECS) {
      const issue = await ensureIssue(spec)
      if (issue === null) {
        notes.push(`${spec.tag}：未建单`)
        continue
      }
      if (!issue.description.includes(tagText(spec.tag))) {
        // 同点位同类型的人工上报会被"十分钟时间桶"并成一条：拿到的可能是别人的问题，
        // 不能替它下审核结论，如实说明并跳过。
        notes.push(`${spec.tag}：与既有问题冲突（${issue.issueNo}），本场景跳过、未审核`)
        continue
      }
      if (issue.status !== 'pending_review') {
        skipped += 1
        notes.push(`${spec.tag}：已审核（${issue.issueNo}）`)
        continue
      }
      const payload: ReviewPayload = { ...spec.review }
      if (spec.review.action === 'link_object') {
        const target = linkTarget('问题池·转维修')
        if (target === undefined) {
          notes.push(`${spec.tag}：缺少可关联的既有问题，已跳过`)
          continue
        }
        payload.duplicateOf = target
      }
      const out = await issues.reviewIssue(issue.id, payload)
      if (!out.ok) {
        notes.push(`${spec.tag}：审核被拒（${out.error}）`)
        continue
      }
      created += 1
      notes.push(`${spec.tag}：${out.issue?.issueNo ?? issue.issueNo} → ${out.issue?.status ?? ''}`)
    }
    await issues.reload()
  })

  const message = `六类审核出口：新审核 ${created} 条、已就绪 ${skipped} 条｜${notes.join('；')}`
  await logScenario(key, '问题池（六类审核出口全覆盖）', message)
  const focus = pendingDemoId()
  return makeResult(key, true, message, {
    created,
    skipped,
    anchorRefs: issues.issues
      .filter((row) => row.description.includes(tagText('问题池')))
      .map((row) => ({ kind: 'issue' as const, id: row.id })),
    ...(focus === '' ? {} : { focus: { path: '/issues', query: { issue: focus } } }),
  })
}

/** 自动定位目标：六类出口里仍停在"待审核"的那条（最能说明"还没处置"）。 */
function pendingDemoId(): string {
  const issues = useIssueStore()
  return issues.issues.find((row) => row.description.includes(tagText('问题池')) && row.status === 'pending_review')?.id ?? ''
}

const RECHECK_SPECS: (IssueSpec & { form: 'overdue' | 'observing' | 'recurred' })[] = [
  {
    tag: '复查·逾期',
    pointId: 'pnt_b03_f1_check01',
    buildingId: 'bld_b03',
    floorId: 'flr_b03_01',
    zoneId: '一层走廊',
    anomalyType: '顶棚返潮',
    summary: '一层走廊顶棚返潮，需复测渗漏点并留观。',
    review: { action: 'recheck', category: 'remeasure', note: '需再次测量或补拍证据' },
    form: 'overdue',
  },
  {
    tag: '复查·继续观察',
    pointId: 'pnt_b04_f1_check01',
    buildingId: 'bld_b04',
    floorId: 'flr_b04_01',
    zoneId: '一层主馆区',
    anomalyType: '墙面起鼓',
    summary: '主馆区墙面起鼓已处理，需继续观察一周期。',
    review: { action: 'recheck', category: 'unclear', note: '情况不明，安排复查' },
    form: 'observing',
  },
  {
    tag: '复查·复发',
    pointId: 'pnt_b02_f1_check01',
    buildingId: 'bld_b02',
    floorId: 'flr_b02_01',
    zoneId: '一层走廊',
    anomalyType: '地面返潮',
    summary: '实验楼一层门口地面返潮，前次处理后再次出现。',
    review: { action: 'recheck', category: 'remeasure', note: '需再次测量或补拍证据' },
    form: 'recurred',
  },
]

/** 复查场景：三条待复查问题，分别给出逾期、继续观察、复发转处置。 */
export async function loadRecheckScenario(): Promise<DemoScenarioResult> {
  const key = 'recheck' as const
  const issues = useIssueStore()
  await issues.reload()
  const notes: string[] = []
  let created = 0
  let skipped = 0

  await withActor('safety', async () => {
    for (const spec of RECHECK_SPECS) {
      let current = await ensureIssue(spec)
      if (current === null) {
        notes.push(`${spec.tag}：未建单`)
        continue
      }
      if (!current.description.includes(tagText(spec.tag))) {
        // 人工上报会按"来源:地点:异常类型:十分钟时间桶"自动归并，同点位同类型的两次上报会并成一条。
        // 这里如实说明并跳过，不去改写别人的问题。
        notes.push(`${spec.tag}：与既有问题合并（${current.issueNo}），本场景跳过`)
        continue
      }
      if (current.status === 'pending_review') {
        const out = await issues.reviewIssue(current.id, spec.review)
        if (!out.ok) {
          notes.push(`${spec.tag}：审核被拒（${out.error}）`)
          continue
        }
        current = findIssue(spec.tag) ?? current
      }
      const rounds = current.rechecks ?? []
      if (spec.form !== 'overdue' && rounds.some((row) => row.outcome !== null)) {
        skipped += 1
        notes.push(`${spec.tag}：已有结论 ${current.issueNo}`)
        continue
      }
      const registered = await registerIfNeeded(current, spec.form)
      if (!registered.ok) {
        notes.push(`${spec.tag}：${registered.error}`)
        continue
      }
      if (spec.form === 'overdue') {
        created += 1
        notes.push(`${spec.tag}：${current.issueNo} 已登记逾期复查`)
        continue
      }
      const outcome = spec.form === 'observing' ? 'observing' : 'recurred'
      const done = await issues.recordRecheckOutcome(current.id, {
        outcome,
        note: spec.form === 'observing' ? '现场复核未见扩大，继续观察一周期' : '处理后再现，判定复发转处置',
        ...(spec.form === 'observing' ? { nextDueDate: dayKeyOffset(3, todayKey()) } : {}),
      })
      if (!done.ok) {
        notes.push(`${spec.tag}：结论被拒（${done.error}）`)
        continue
      }
      created += 1
      notes.push(`${spec.tag}：${current.issueNo} 结论已记录`)
    }
    await issues.reload()
  })

  const message = `复查三态：已处理 ${created} 条、已就绪 ${skipped} 条｜${notes.join('；')}`
  await logScenario(key, '复查与观察期（三种结论）', message)
  const overdue = findIssue('复查·逾期')
  return makeResult(key, true, message, {
    created,
    skipped,
    anchorRefs: issues.issues
      .filter((row) => row.description.includes(tagText('复查')))
      .map((row) => ({ kind: 'issue' as const, id: row.id })),
    ...(overdue === undefined ? {} : { focus: { path: '/issues', query: { issue: overdue.id } } }),
  })
}

function todayKey(): string {
  return todayInput()
}

/** 登记复查：逾期那条把目标日期放在昨天，其余放在两天后。 */
async function registerIfNeeded(
  issue: InspectionIssue,
  form: 'overdue' | 'observing' | 'recurred',
): Promise<{ ok: boolean; error: string }> {
  const issues = useIssueStore()
  const open = (issue.rechecks ?? []).find((row) => row.outcome === null)
  if (open !== undefined) return { ok: true, error: '' }
  const dueDate = form === 'overdue' ? dayKeyOffset(-1, todayKey()) : dayKeyOffset(2, todayKey())
  const out = await issues.registerRecheck(issue.id, {
    subject: '复测并留观现场情况',
    owner: '李老师（后勤保障处）',
    dueDate,
  })
  return { ok: out.ok, error: out.error }
}

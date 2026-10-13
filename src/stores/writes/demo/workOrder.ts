/**
 * 工单闭环场景：待派工 / 处理中 / 待验收 / 验收退回 / 已验收通过。
 *
 * 每一步都走 `workOrders.advanceOrder`，顺序与权限由状态机判定；
 * 完工照片先入库拿 ID 再随"提交完工"提交，验收照片随验收结论**同事务**提交。
 */
import type { AttachmentKind } from '@/types/inspection'
import type { DraftPhotoInput } from '@/db/inspection/attachments'
import type { DemoActorKey } from './support'
import { todayInput } from '@/core/time'
import { P_CRACK } from '@/db/seedFactories'
import { useEventsStore } from '@/stores/events'
import { useAttachmentStore } from '@/stores/inspection/attachments'
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

export interface OrderSpec {
  tag: string
  pointId: string
  buildingId: string
  floorId: string
  zoneId: string
  anomalyType: string
  summary: string
  /** 要走到哪一步 */
  target: 'created' | 'assigned' | 'repairing' | 'submitted' | 'returned' | 'verified'
  /**
   * 这条是否由**预警事件**转出。
   * 全链要能核验"预警 → 问题 → 工单 → 验收 → 复查"确实相连，就必须有一条真从事件转出来的问题；
   * 全用人工上报的话，各模块各自成功，但业务链在数据上是不连的。
   */
  fromEvent?: boolean
}

const ORDER_SPECS: OrderSpec[] = [
  {
    tag: '工单·待派工',
    pointId: 'pnt_b03_f1_check01', buildingId: 'bld_b03', floorId: 'flr_b03_01', zoneId: '一层走廊',
    anomalyType: '门窗损坏',
    summary: '一层走廊防火门闭门器损坏，需要更换。',
    target: 'created',
  },
  {
    tag: '工单·处理中',
    pointId: 'pnt_b04_f1_check01', buildingId: 'bld_b04', floorId: 'flr_b04_01', zoneId: '一层主馆区',
    anomalyType: '照明故障',
    summary: '主馆区两盏顶灯不亮，已派维修到场处理。',
    target: 'repairing',
  },
  {
    tag: '工单·待验收',
    pointId: 'pnt_b01_f1_check01', buildingId: 'bld_b01', floorId: 'flr_b01_01', zoneId: '一层走廊',
    anomalyType: '排水不畅',
    summary: '一层走廊地漏排水缓慢，已疏通并提交完工待验收。',
    target: 'submitted',
  },
  {
    tag: '工单·验收退回',
    pointId: 'pnt_b02_f1_check01', buildingId: 'bld_b02', floorId: 'flr_b02_01', zoneId: '一层走廊',
    anomalyType: '墙面污损',
    summary: '实验楼一层墙面污损修补后色差明显，验收退回返工。',
    target: 'returned',
  },
  {
    tag: '工单·已验收',
    // 由预警事件转出，所以必须与事件同测点；问题也就落在裂缝测点上
    pointId: 'pnt_b03_f2_crack01', buildingId: 'bld_b03', floorId: 'flr_b03_02', zoneId: '二层走廊',
    anomalyType: '裂缝',
    summary: '二层走廊西墙裂缝经预警后转问题处置，修补完成并验收通过。',
    target: 'verified',
    fromEvent: true,
  },
]

const MEASURES = '清理松动部位后按原做法修补，现场清扫并恢复使用'
const MATERIALS = '修补砂浆 2 kg、密封胶 1 支'
const ASSIGNEE = '维修人员'

/** 下一次该走的状态；`submitted` 之后由目标决定去验收还是退回。 */
const NEXT_STATUS: Record<string, string> = {
  created: 'assigned',
  assigned: 'repairing',
  repairing: 'submitted',
  returned: 'repairing',
}

async function advance(
  key: DemoActorKey,
  orderId: string,
  to: string,
  payload: Record<string, unknown>,
): Promise<string> {
  return withActor(key, async () => {
    const store = useWorkOrderStore()
    const out = await store.advanceOrder(orderId, to as never, payload as never)
    return out.ok ? '' : `${to} 被拒（${out.error}）`
  })
}

/** 按草稿标识确认完工照片是否已在库；不在就补一张合成照片。 */
async function completionPhotoIds(orderId: string, actor: string): Promise<string[]> {
  const attachments = useAttachmentStore()
  const drafts = [1, 2]
  const existing = await attachments.existingOfOrder(orderId)
  const ids = drafts
    .map((index) => existing.find((row) => row.draftId === `demo-${orderId}-after-${index}`))
    .filter((row) => row !== undefined)
    .map((row) => row.id)
  if (ids.length === drafts.length) return ids
  for (const index of drafts) {
    const draftId = `demo-${orderId}-after-${index}`
    if (existing.some((row) => row.draftId === draftId)) continue
    const file = await makeDemoPhoto(`完工照片${index}`, 32 + index * 8)
    if (file === null) continue
    const saved = await attachments.add({
      file,
      kind: 'after' as AttachmentKind,
      issueId: null,
      workOrderId: orderId,
      actor,
      capturedAt: null,
      draftId,
    })
    ids.push(saved.id)
  }
  return ids
}

/** 验收照片草稿：附件主键由 draft.id 派生，天然幂等。 */
async function acceptanceDraft(orderId: string): Promise<DraftPhotoInput[]> {
  const file = await makeDemoPhoto('验收照片', 168)
  if (file === null) return []
  return [await demoDraft(`demo-${orderId}-acceptance`, file)]
}

/** 演示脚本用的裂缝测点上的未关闭事件：事件转问题的来源。 */
function crackEventId(events: ReturnType<typeof useEventsStore>): string {
  return events.sorted.find((row) => row.pointId === P_CRACK && row.status !== 'closed')?.id ?? ''
}

/**
 * 验收通过后登记复查。
 * 不做这一步，业务链就停在"已验证"，全链核验会报"缺复查登记"。
 */
async function registerRound(tag: string, issueId: string): Promise<void> {
  const issues = useIssueStore()
  const current = issues.byId(issueId)
  if (current === undefined || (current.rechecks ?? []).length > 0) return
  await withActor('safety', async () =>
    issues.registerRecheck(issueId, {
      subject: `${tag}：复测并留观`,
      owner: '李老师（后勤保障处）',
      dueDate: dayKeyOffset(3, todayInput()),
    }),
  )
}

/** 把一张工单推到目标状态；已在该状态则直接返回，不重复写库。 */
export async function reachTarget(spec: OrderSpec, orderId: string): Promise<string> {
  const store = useWorkOrderStore()
  for (let guard = 0; guard < 6; guard += 1) {
    const order = store.byId(orderId)
    if (order === undefined) return '工单不存在'
    if (order.status === spec.target) return ''
    if (order.status === 'submitted') {
      if (spec.target === 'verified') {
        const drafts = await acceptanceDraft(orderId)
        return advance('safety', orderId, 'verified', {
          note: '验收合格，同意交付；照片与结论一并留痕',
          acceptancePhotos: drafts,
        })
      }
      if (spec.target === 'returned') {
        return advance('safety', orderId, 'returned', { note: '施工痕迹未清理干净，退回返工' })
      }
      return `目标状态 ${spec.target} 不能从"待验收"直达`
    }
    const next = NEXT_STATUS[order.status]
    if (next === undefined) return `无法从 ${order.status} 继续`
    if (next === 'assigned') {
      const error = await advance('safety', orderId, 'assigned', { assignee: ASSIGNEE })
      if (error !== '') return error
      continue
    }
    if (next === 'repairing') {
      const error = await advance('repair', orderId, 'repairing', {})
      if (error !== '') return error
      continue
    }
    const photos = await completionPhotoIds(orderId, '孙老师（物业维修）')
    const error = await advance('repair', orderId, 'submitted', {
      measures: MEASURES,
      materials: MATERIALS,
      photos,
    })
    if (error !== '') return error
  }
  return '步骤超过上限，已停止（避免死循环）'
}

/** 工单闭环：五张工单覆盖五个状态。 */
export async function loadWorkOrdersScenario(): Promise<DemoScenarioResult> {
  const key = 'workOrders' as const
  const issues = useIssueStore()
  const store = useWorkOrderStore()
  const events = useEventsStore()
  await issues.reload()
  await store.reload()
  // 事件转问题要按事件当前状态判断，先重读一次
  await events.reload()
  const notes: string[] = []
  let created = 0
  let skipped = 0

  for (const spec of ORDER_SPECS) {
    const text = `演示场景[${spec.tag}]`
    let issue = issues.issues.find((row) => row.description.includes(text))
    const fresh = issue === undefined
    if (issue === undefined) {
      const fromEvent = spec.fromEvent === true ? crackEventId(events) : ''
      if (fromEvent !== '') {
        // 由预警事件转出的问题：让"预警 → 问题 → 工单 → 复查"在数据上真的连起来
        const out = await withActor('safety', async () =>
          issues.createIssueFromEvent({
            eventId: fromEvent,
            pointId: spec.pointId,
            buildingId: spec.buildingId,
            floorId: spec.floorId,
            zoneId: spec.zoneId,
            anomalyType: spec.anomalyType,
            description: `${text} ${spec.summary}`,
            photos: [],
            detail: `演示场景导入：由预警事件转出的问题 —— ${spec.summary}`,
          }),
        )
        issue = out.issue
      } else {
        const out = await issues.reportManualIssue({
          pointId: spec.pointId,
          buildingId: spec.buildingId,
          floorId: spec.floorId,
          zoneId: spec.zoneId,
          anomalyType: spec.anomalyType,
          description: `${text} ${spec.summary}`,
          photos: [],
          detail: `演示场景导入：${spec.summary}`,
        })
        issue = out.issue
      }
      created += 1
    }
    if (issue.status === 'pending_review') {
      const out = await withActor('safety', async () =>
        issues.reviewIssue(issue.id, { action: 'to_repair', category: 'general', note: '转维修工单处理' }),
      )
      if (!out.ok) {
        notes.push(`${spec.tag}：转维修被拒（${out.error}）`)
        continue
      }
    }
    await store.reload()
    const order = store.ordersOfIssue(issue.id)[0]
    if (order === undefined) {
      notes.push(`${spec.tag}：没有生成工单`)
      continue
    }
    if (order.status === spec.target) {
      // 目标就是"待派工"时，审核转维修这一步已经把它建成该状态，不能算"已就绪"
      if (fresh) notes.push(`${spec.tag}：${order.orderNo} 已建成`)
      else {
        skipped += 1
        notes.push(`${spec.tag}：${order.orderNo} 已是目标状态`)
      }
      continue
    }
    const error = await reachTarget(spec, order.id)
    if (error !== '') notes.push(`${spec.tag}：${error}`)
    else notes.push(`${spec.tag}：${order.orderNo} → ${spec.target}`)
    if (spec.fromEvent === true) await registerRound(spec.tag, issue.id)
  }

  await store.reload()
  await issues.reload()
  const message = `工单闭环：新建问题 ${created} 条、已就绪 ${skipped} 张｜${notes.join('；')}`
  await logScenario(key, '工单闭环（含验收退回）', message)
  const busyIssue = issues.issues.find((row) => row.description.includes('演示场景[工单·处理中]'))
  return makeResult(key, true, message, {
    created,
    skipped,
    anchorRefs: issues.issues
      .filter((row) => row.description.includes('演示场景[工单'))
      .map((row) => ({ kind: 'issue' as const, id: row.id })),
    ...(busyIssue === undefined ? {} : { focus: { path: '/issues', query: { issue: busyIssue.id } } }),
  })
}

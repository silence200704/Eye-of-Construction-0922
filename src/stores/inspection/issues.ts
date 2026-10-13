/**
 * 问题池仓储：传感器预警、巡检发现、人工上报三类来源共用。
 *
 * 汇聚口径（评审确定）：`submissionKey` 只防"同一次提交动作重试重复建单"；
 * 跨来源的疑似重复用 candidateDuplicates() 提示，由审核人员选择关联，不静默合并。
 */
import { computed, ref } from 'vue'
import { publishReuse } from '@/core/operations/receipts'
import { defineStore } from 'pinia'
import type { InspectionIssue, IssueSource, RecheckOutcome, ReviewAction } from '@/types/inspection'
import type { AlarmEvent } from '@/types/events'
import { candidateDuplicates, submissionKeyOf } from '@/core/inspection/issueMerge'
import type { DraftPhotoInput } from '@/db/inspection/attachments'
import { buildDraftPhoto } from '@/db/inspection/attachments'
import { nowIso } from '@/core/time'
import { toPlain } from '@/core/plain'
import { db } from '@/db/database'
import { buildAuditLog, putIssue } from '@/db/repo'
import {
  createIssueAtomic,
  issueIdOf,
  planIssueRow,
  type IssueRowDraft,
} from '@/db/inspection/issueWrites'
import { performReview } from './issueReview'
import { commitRecheckOutcome, commitRecheckRegister } from './issueRecheck'
import { useArchiveStore } from '../archive'
import { useWorkOrderStore } from './workOrders'
import { useSessionStore } from '../session'

export interface IssueDraft {
  source: IssueSource
  pointId: string | null
  buildingId: string
  floorId: string
  zoneId: string
  anomalyType: string
  description: string
  photos: string[]
  /**
   * 随问题一起落库的现场照片草稿（页面已压缩）。
   * 附件不先单独入库：与问题、时间线、审计日志在同一个事务里提交。
   */
  photoDrafts?: DraftPhotoInput[]
  eventId?: string | null
  taskId?: string | null
  windowMinutes?: number
  /** 时间线里那条说明（例如"巡检时发现探头支架松动"） */
  detail: string
}

export interface SubmitOutcome {
  issue: InspectionIssue
  /** 命中同一次提交的已有记录：页面应提示"已关联现有问题"，不重复建单 */
  duplicated: boolean
  candidates: InspectionIssue[]
}

export interface ReviewPayload {
  action: ReviewAction
  category: string
  note: string
  duplicateOf?: string | null
  linkedEventId?: string | null
  /**
   * 「已当场处理」的现场照片草稿。
   * 附件**不先单独入库**，而是与审核结论、工单、审计日志在同一个事务里提交 ——
   * 先写照片后写审核，审核一旦失败就会留下"附件已挂在问题上、审核结论没落库"的半成品。
   */
  photoDrafts?: DraftPhotoInput[]
  /** 现场没法拍照时写的原因：与照片二者至少成立一条 */
  noPhotoReason?: string
}

export interface IssueActionResult {
  ok: boolean
  error: string
  issue: InspectionIssue | null
}

/**
 * 预警转问题必须带真实事件标识。事件是这条问题的来源依据，不能由页面省略或伪造。
 */
export type EventIssueDraft = Omit<IssueDraft, 'source' | 'eventId'> & { eventId: string }

export const useIssueStore = defineStore('inspectionIssues', () => {
  const issues = ref<InspectionIssue[]>([])
  const loaded = ref(false)

  const openIssues = computed(() => issues.value.filter((row) => row.status !== 'closed'))
  const pendingReview = computed(() => issues.value.filter((row) => row.status === 'pending_review'))

  async function reload(): Promise<void> {
    issues.value = await db.issues.toArray()
    loaded.value = true
  }

  function byId(id: string): InspectionIssue | undefined {
    return issues.value.find((row) => row.id === id)
  }

  function byNo(issueNo: string): InspectionIssue | undefined {
    return issues.value.find((row) => row.issueNo === issueNo)
  }

  const issuesOfPoint = (pointId: string): InspectionIssue[] => issues.value.filter((row) => row.pointId === pointId)
  const issuesOfTask = (taskId: string): InspectionIssue[] => issues.value.filter((row) => row.taskId === taskId)

  /** 疑似重复：给审核人员看的候选，不做自动合并。 */
  function duplicatesFor(probe: Parameters<typeof candidateDuplicates>[1], excludeKey = ''): InspectionIssue[] {
    return candidateDuplicates(issues.value, probe, excludeKey)
  }

  async function reset(): Promise<void> {
    issues.value = []
    loaded.value = false
  }

  return {
    issues,
    loaded,
    openIssues,
    pendingReview,
    byId,
    byNo,
    issuesOfPoint,
    issuesOfTask,
    duplicatesFor,
    submissionKeyFor,
    reportManualIssue,
    reviewIssue,
    createIssueFromEvent,
    registerRecheck,
    recordRecheckOutcome,
    attachPhotos,
    reload,
    reset,
  }

  /** 构造问题行用的草稿（内部）：任务来源由 tasks store 组装，这里只服务人工上报与预警转单。 */
  function draftWithKey(draft: IssueDraft): IssueRowDraft {
    const at = nowIso()
    const key = submissionKeyOf({
      source: draft.source,
      pointId: draft.pointId,
      buildingId: draft.buildingId,
      anomalyType: draft.anomalyType,
      at,
      eventId: draft.eventId ?? null,
      windowMinutes: draft.windowMinutes,
    })
    return {
      source: draft.source,
      submissionKey: key,
      pointId: draft.pointId,
      buildingId: draft.buildingId,
      floorId: draft.floorId,
      zoneId: draft.zoneId,
      eventId: draft.eventId ?? null,
      taskId: draft.taskId ?? null,
      anomalyType: draft.anomalyType,
      description: draft.description,
      photos: [...draft.photos],
      detail: draft.detail,
    }
  }

  /**
   * 计算提交标识（页面与任务入口共用）。
   * 权威去重不靠它 —— 同一标识会推出同一个主键，由数据库的约束来保证唯一。
   */
  function submissionKeyFor(draft: IssueDraft): string {
    return submissionKeyOf({
      source: draft.source,
      pointId: draft.pointId,
      buildingId: draft.buildingId,
      anomalyType: draft.anomalyType,
      at: nowIso(),
      eventId: draft.eventId ?? null,
      windowMinutes: draft.windowMinutes,
    })
  }

  /**
   * 非任务来源的问题写入：问题与审计日志在**同一个事务**里提交。
   * 先写问题再写日志的话，日志失败会留下一条没有审计记录的问题。
   */
  async function writeIssue(draft: IssueDraft, eventForTimeline: AlarmEvent | null = null): Promise<SubmitOutcome> {
    const session = useSessionStore()
    const at = nowIso()
    const keyed = draftWithKey(draft)
    /*
     * 照片在这里**只构造不写库**：附件与问题、任务、事件时间线、审计日志在同一个事务里提交。
     * 先写照片再建问题（或反之）都会留下半成品；附件主键由草稿标识推出，重试不会重复新增。
     */
    const attachments = (draft.photoDrafts ?? []).map((item) =>
      buildDraftPhoto(item, { kind: 'scene', issueId: issueIdOf(keyed.submissionKey), workOrderId: null, actor: session.name }),
    )
    const row = planIssueRow(
      { ...keyed, photos: [...keyed.photos, ...attachments.map((item) => item.id)] },
      { actor: session.name, actorRole: session.roleLabel, at },
    )
    const position = await labelOf(row)
    const result = await createIssueAtomic({
      issue: row,
      task: null,
      attachments,
      photoTrace: { at, by: session.name, byRole: session.roleLabel },
      eventId: eventForTimeline?.id ?? null,
      buildEvent:
        eventForTimeline === null
          ? undefined
          : (event, issue) => ({
              ...event,
              updatedAt: at,
              updatedBy: session.name,
              timeline: [
                ...event.timeline,
                {
                  at,
                  by: session.name,
                  action: '转问题处理',
                  detail: `创建关联问题 ${issue.issueNo}：${draft.detail}`,
                },
              ],
            }),
      buildLogs: (issue) => [
        buildAuditLog({
          actor: session.name,
          actorRole: session.roleLabel,
          action: 'create',
          objectType: 'system',
          objectId: issue.id,
          objectLabel: `${issue.issueNo} ${issue.anomalyType}`,
          summary: `提交问题 ${issue.issueNo}`,
          reason: `来源：${issue.source}；位置：${position}；照片 ${issue.photos.length} 张；${draft.detail}`,
        }),
      ],
    })
    await reload()
    if (!result.created) await publishReuse({ db, id: result.issue.id, actor: session.name, at })
    return { issue: result.issue, duplicated: !result.created, candidates: [] }
  }

  /**
   * 人工上报：现场任何人都可以报（方案 §1：巡检人员负责上报，物业与安全管理人员同样能报）。
   * 它不属于某个任务，因此没有 taskId。
   */
  async function reportManualIssue(draft: Omit<IssueDraft, 'source' | 'taskId'>): Promise<SubmitOutcome> {
    return writeIssue({ ...draft, source: 'report', taskId: null })
  }

  /**
   * 预警转单：把一次预警事件转成问题，只有学校安全管理人员可以操作
   * （预警的审核与派单权限在安全管理人员手上，方案 §1）。
   */
  async function createIssueFromEvent(draft: EventIssueDraft): Promise<SubmitOutcome> {
    const session = useSessionStore()
    if (session.role !== 'safety') {
      throw new Error('预警转单由学校安全管理人员执行')
    }
    const eventId = draft.eventId.trim()
    const event = await db.events.get(eventId)
    if (event === undefined) throw new Error('预警事件不存在，不能转问题处理')
    if (draft.pointId !== event.pointId) throw new Error('问题测点与预警事件测点不一致，不能转问题处理')
    return writeIssue({ ...draft, source: 'sensor', eventId: event.id }, event)
  }

  /**
   * 审核：一级出口 + 二级分类 + 审核意见，判定在 core 里做，写库与日志同事务。
   * 关联既有对象时一并记下关联到的问题或事件，保证"两次发现"都留得住。
   */
  async function reviewIssue(issueId: string, input: ReviewPayload): Promise<IssueActionResult> {
    const session = useSessionStore()

    /*
     * 权限在仓储层拦：页面隐藏按钮不算权限控制 —— 新增入口或直接调 store 时，
     * 物业与巡检身份仍可能写入审核结果。这里先拦，再做任何判定与写库。
     */
    if (session.role !== 'safety') {
      return { ok: false, error: '审核由学校安全管理人员执行，当前身份无权提交', issue: null }
    }

    const issue = await db.issues.get(issueId)
    if (issue === undefined) return { ok: false, error: '问题不存在', issue: null }

    const workOrders = useWorkOrderStore()
    const out = await performReview({
      issue,
      action: input.action,
      category: input.category,
      note: input.note,
      duplicateOf: input.duplicateOf ?? null,
      linkedEventId: input.linkedEventId ?? null,
      photoDrafts: input.photoDrafts ?? [],
      noPhotoReason: input.noPhotoReason ?? '',
      actor: session.name,
      actorRole: session.roleLabel,
      buildOrder: (row) =>
        workOrders.buildForIssue({
          issue: row,
          actor: session.name,
          actorRole: session.roleLabel,
          title: `${row.anomalyType}（${row.issueNo}）`,
          eventId: row.eventId,
        }),
    })
    if (!out.ok) return { ok: false, error: out.error, issue: null }
    await reload()
    if (input.action === 'to_repair') await workOrders.reload()
    return { ok: true, error: '', issue: out.issue }
  }

  /**
   * 登记复查：写入在 issueRecheck 模块（含权限与留痕），这里只负责重载。
   *
   * 事务失败（写库或日志写入抛错）在这里**转成失败结果**而不是继续往外抛：
   * 页面只写了 try/finally 时，抛出去的异常就只剩一条控制台错误，用户看不到任何提示。
   * 事务性写入失败必然整笔回滚，所以文案可以明确说"未写入数据"，不需要用户去猜。
   */
  async function registerRecheck(
    issueId: string,
    input: { subject: string; owner: string; dueDate: string },
  ): Promise<IssueActionResult> {
    let out: IssueActionResult
    try {
      out = await commitRecheckRegister(issueId, input)
    } catch (cause) {
      return { ok: false, error: `保存失败，未写入数据：${(cause as Error).message}（可重试）`, issue: null }
    }
    if (out.ok) await reload()
    return out
  }

  /** 记录复查结论：同上（含异常转失败结果）。 */
  async function recordRecheckOutcome(
    issueId: string,
    input: { outcome: RecheckOutcome; note: string; nextDueDate?: string },
  ): Promise<IssueActionResult> {
    let out: IssueActionResult
    try {
      out = await commitRecheckOutcome(issueId, input)
    } catch (cause) {
      return { ok: false, error: `保存失败，未写入数据：${(cause as Error).message}（可重试）`, issue: null }
    }
    if (out.ok) await reload()
    return out
  }

  /**
   * 把照片挂到问题上。
   * 照片先入库（附件必须能独立存在），建问题后再回填照片 ID；
   * 中途失败时问题已在、照片缺几张，页面提示重试即可，不伪造"全部上传成功"。
   */
  async function attachPhotos(issueId: string, attachmentIds: string[]): Promise<InspectionIssue | null> {
    const issue = byId(issueId)
    if (issue === undefined) return null
    const session = useSessionStore()
    const at = nowIso()
    const photos = [...new Set([...issue.photos, ...attachmentIds])]
    const row: InspectionIssue = {
      ...issue,
      photos,
      updatedAt: at,
      updatedBy: session.name,
      timeline: [
        ...issue.timeline,
        { at, by: session.name, byRole: session.roleLabel, action: '补充照片', detail: `新增 ${attachmentIds.length} 张现场照片` },
      ],
    }
    await putIssue(toPlain(row))
    await reload()
    return row
  }

  async function labelOf(issue: InspectionIssue): Promise<string> {
    const archive = useArchiveStore()
    const point = issue.pointId === null ? undefined : archive.pointById(issue.pointId)
    return point === undefined ? `${issue.buildingId} ${issue.zoneId}` : `${point.code} ${point.name}`
  }
})

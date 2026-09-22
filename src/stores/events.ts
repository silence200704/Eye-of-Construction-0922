/**
 * 预警事件与站内通知状态。
 *
 * 事件承载"判定结果 → 人的处置"这条链路：待确认 → 处理中 → 恢复待确认 → 已关闭。
 * 通知记录"已生成、已展示、已确认"三种状态；未接入真实渠道，不写短信或推送送达。
 * 浏览器关闭期间不执行后台任务，重新打开时由 catchUpEscalations 补查超时升级。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '@/db/database'
import { buildAuditLog, commitEventAcknowledge, commitEventClose, putNotification, putNotifications } from '@/db/repo'
import { dayKey, nowIso } from '@/core/time'
import { withTimeline } from '@/core/inspection/issueMerge'
import type { AlarmEvent, AlarmNotification, EventLevel, EventStatus } from '@/types/events'
import { EVENT_LEVEL_LABEL, EVENT_STATUS_LABEL } from '@/types/events'
import type { AuditLog } from '@/types/domain'
import { closeGuard, planClose } from '@/core/event/plan'
import { useArchiveStore } from './archive'
import { useSessionStore } from './session'
import { useWorkOrderStore } from './inspection/workOrders'
import { useIssueStore } from './inspection/issues'

/**
 * 关闭事件的输入。
 * `basis` 是人写的复查结论，`noRepairNote` 是没有关联工单时安全管理人员写的"无需维修"现场核查结论 ——
 * 两者缺一不可：前者说明"数据确实恢复了"，后者说明"处置确实完成了"（方案 §3 与评审要求）。
 */
export interface EventCloseInput {
  basis: string
  noRepairNote: string
}

export const useEventsStore = defineStore('events', () => {
  const events = ref<AlarmEvent[]>([])
  const notifications = ref<AlarmNotification[]>([])
  const loaded = ref(false)

  /*
   * 时钟刻度：通知是否超时由 `Date.now()` 决定，而它不是响应式的 ——
   * 页面放着不动，"已超时"的条数就永远停在上一次算出来的结果上。
   * 这里做成可手动推进的依赖：点「立即检查超时通知」先把它推到当前时刻再判定。
   */
  const clock = ref(nowIso())

  async function reload(): Promise<void> {
    const [rows, notes] = await Promise.all([
      db.events.toArray(),
      db.notifications.toArray(),
    ])
    events.value = rows
    notifications.value = notes
  }

  async function load(): Promise<void> {
    await reload()
    loaded.value = true
  }

  /** 事件编号按自然日计数，形如 E20260920-001。 */
  function nextEventNo(sampleTime: string): string {
    const prefix = `E${dayKey(sampleTime)}-`
    const used = events.value
      .map((row) => row.eventNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number.parseInt(no.slice(prefix.length), 10))
      .filter((value) => Number.isFinite(value))
    const next = (used.length === 0 ? 0 : Math.max(...used)) + 1
    return `${prefix}${String(next).padStart(3, '0')}`
  }

  /** 未关闭事件：事件归并与去重的依据。 */
  const openEvents = computed(() => events.value.filter((row) => row.status !== 'closed'))

  const sorted = computed(() =>
    [...events.value].sort((a, b) => (a.lastTriggerAt < b.lastTriggerAt ? 1 : -1)),
  )

  function byId(id: string): AlarmEvent | undefined {
    return events.value.find((row) => row.id === id)
  }

  function openEventOf(pointId: string, ruleId: string): AlarmEvent | undefined {
    return events.value.find((row) => row.pointId === pointId && row.ruleId === ruleId && row.status !== 'closed')
  }

  function eventsOfPoint(pointId: string): AlarmEvent[] {
    return sorted.value.filter((row) => row.pointId === pointId)
  }

  function notificationsOf(eventId: string): AlarmNotification[] {
    return notifications.value
      .filter((row) => row.eventId === eventId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }

  const countByStatus = computed(() => {
    const counts: Record<EventStatus, number> = { pending: 0, handling: 0, recovering: 0, closed: 0 }
    for (const row of events.value) counts[row.status] += 1
    return counts
  })

  const countByLevel = computed(() => {
    const counts: Record<EventLevel, number> = { yellow: 0, orange: 0, red: 0 }
    for (const row of openEvents.value) counts[row.level] += 1
    return counts
  })

  /** 超时未确认的通知：演示时限内未确认即应提醒替补或升级。 */
  const overdueNotifications = computed(() =>
    notifications.value.filter(
      (row) => row.acknowledgedAt === null && row.escalatedAt === null && minutesSince(row.createdAt) > row.dueMinutes,
    ),
  )

  function minutesSince(iso: string): number {
    return (new Date(clock.value).getTime() - new Date(iso).getTime()) / 60_000
  }

  async function markPresented(eventId: string): Promise<void> {
    const targets = notifications.value.filter((row) => row.eventId === eventId && row.presentedAt === null)
    if (targets.length === 0) return
    const at = nowIso()
    await putNotifications(targets.map((row) => ({ ...row, presentedAt: at })))
    await reload()
  }

  async function acknowledgeNotification(id: string): Promise<void> {
    const archive = useArchiveStore()
    const session = useSessionStore()
    const row = notifications.value.find((item) => item.id === id)
    if (row === undefined || row.acknowledgedAt !== null) return
    const at = nowIso()
    await putNotification({ ...row, acknowledgedAt: at, acknowledgedBy: session.name })
    await reload()
    await archive.log('update', 'record', row.eventId, row.eventNo, `确认通知：${row.eventNo} → ${row.target}`, '')
  }

  /** 安全管理人员确认事件：待确认 → 处理中。 */
  async function acknowledgeEvent(eventId: string): Promise<void> {
    const archive = useArchiveStore()
    const session = useSessionStore()
    const event = byId(eventId)
    if (event === undefined || event.status !== 'pending') return
    const at = nowIso()
    // 该事件下所有未确认通知一并标记为已确认，避免重复提醒；两者同事务提交
    const pendingNotes = notifications.value
      .filter((item) => item.eventId === eventId && item.acknowledgedAt === null)
      .map((item) => ({ ...item, acknowledgedAt: at, acknowledgedBy: session.name }))
    await commitEventAcknowledge({
      event: {
        ...event,
        status: 'handling',
        acknowledgedAt: at,
        acknowledgedBy: session.name,
        updatedAt: at,
        updatedBy: session.name,
        timeline: [
          ...event.timeline,
          { at, by: session.name, action: '确认事件，转入处理中', detail: `${session.roleLabel} 确认` },
        ],
      },
      notifications: pendingNotes,
    })
    await reload()
    await archive.log('update', 'record', event.id, event.eventNo, `确认预警事件 ${event.eventNo}，转入处理中`, '')
  }

  /**
   * 授权关闭（**唯一入口**）：权限与时机 → 处置依据 → 一次事务写下去。
   *
   * 三道门一起过才算数：
   * 1. `planClose()`：只有学校安全管理人员、只有"恢复待确认"状态（连续 N 条恢复复测由判定引擎给出）、必须填关闭依据；
   * 2. `closeBasis()`：**关联工单已验收通过**，或安全管理人员填写的"无需维修"现场核查结论（读库复核，不看缓存）；
   * 3. 关闭后事件时间线、关联问题时间线与审计日志一起落库，从任意一端进去都能看到同一件事。
   *
   * 关闭事件**不改问题的状态**：问题的关闭有它自己的审核出口，"验收 ≠ 问题关闭、事件关闭 ≠ 问题关闭"。
   */
  async function closeEvent(eventId: string, input: EventCloseInput): Promise<void> {
    const session = useSessionStore()
    const workOrders = useWorkOrderStore()
    const at = nowIso()
    // 以库里的那份为准：缓存可能命中但已过期（例如事件已在别处被关闭）
    const event = await db.events.get(eventId)
    if (event === undefined) throw new Error('事件不存在')
    // 先过权限与时机：库里那份可能已经变了，这一步不省
    const guard = closeGuard(event.status, session.role)
    if (!guard.allowed) throw new Error(guard.reason)

    const check = await workOrders.basisFromDb({
      eventId: event.id,
      pointId: event.pointId,
      noRepairNote: input.noRepairNote,
    })
    if (!check.ok) throw new Error(`关闭前还缺处置依据：${check.reason}`)

    /*
     * 处置依据要留全：没走工单而是靠"无需维修"核查结论关闭时，
     * `check.reason` 只是一句摘要（"已填写现场核查结论（无需维修）"），
     * 结论原文必须一起写进时间线与日志 —— 否则事后只看到"无需维修"四个字，
     * 看不出当时凭什么判断不需要维修。
     */
    const note = input.noRepairNote.trim()
    const basisDetail = check.kind === 'no_repair' && note !== '' ? `${check.reason}（${note}）` : check.reason

    // 真正的写入闸门仍走 planClose：权限、时机、依据三项在 core 里再校验一遍
    const plan = planClose({
      event,
      roleKey: session.role,
      basis: input.basis,
      basisDetail,
      actor: { name: session.name, role: session.roleLabel },
      at,
    })
    if (!plan.ok || plan.next === null) throw new Error(plan.error)
    const next = plan.next

    const detail = `事件 ${next.eventNo} 授权关闭：${basisDetail}；复查结论：${next.closeBasis}`
    const related = await db.issues.where('eventId').equals(next.id).toArray()
    const issues = related.map((issue) =>
      withTimeline(
        { ...issue, updatedAt: at, updatedBy: session.name },
        { at, by: session.name, byRole: session.roleLabel, action: '关联预警事件已关闭', detail },
      ),
    )
    await commitEventClose({
      event: next,
      issues,
      logs: [
        auditOf({ id: next.id, label: next.eventNo }, `关闭预警事件 ${next.eventNo}`, `${basisDetail}；${next.closeBasis}`),
        ...issues.map((issue) =>
          auditOf(
            { id: issue.id, label: `${issue.issueNo} ${issue.anomalyType}` },
            `问题 ${issue.issueNo}：关联事件 ${next.eventNo} 已授权关闭`,
            detail,
          ),
        ),
      ],
    })
    await reload()
    if (issues.length > 0) await useIssueStore().reload()
  }

  /** 关闭写入的操作日志：点名对象与业务编号，事后可倒查。 */
  function auditOf(target: { id: string; label: string }, summary: string, reason: string): AuditLog {
    const session = useSessionStore()
    return buildAuditLog({
      actor: session.name,
      actorRole: session.roleLabel,
      action: 'update',
      objectType: 'record',
      objectId: target.id,
      objectLabel: target.label,
      summary,
      reason,
    })
  }

  /**
   * 补查超时升级：浏览器关闭期间不执行后台任务，
   * 重新打开时把已超时的未确认通知标记为升级并记录去向。
   */
  async function catchUpEscalations(): Promise<number> {
    const archive = useArchiveStore()
    // 先把时钟推到当前时刻：逾期判定依赖它，否则会复用上一次算出来的缓存结果（"点了没反应"）
    clock.value = nowIso()
    const due = overdueNotifications.value
    if (due.length === 0) return 0
    const at = nowIso()
    for (const row of due) {
      await putNotification({ ...row, escalatedAt: at, escalatedTo: row.fallback, escalationSource: '' })
      await archive.log(
        'update',
        'record',
        row.eventId,
        row.eventNo,
        `通知超时升级：${row.eventNo} → ${row.escalatedTo}`,
        `${row.dueMinutes} 分钟未确认，转${row.escalatedTo}；演示管理时限，不是实际应急标准`,
      )
    }
    await reload()
    return due.length
  }

  function levelLabel(level: EventLevel): string {
    return EVENT_LEVEL_LABEL[level]
  }

  function statusLabel(status: EventStatus): string {
    return EVENT_STATUS_LABEL[status]
  }

  return {
    events,
    notifications,
    loaded,
    sorted,
    openEvents,
    countByStatus,
    countByLevel,
    overdueNotifications,
    load,
    reload,
    nextEventNo,
    byId,
    openEventOf,
    eventsOfPoint,
    notificationsOf,
    markPresented,
    acknowledgeNotification,
    acknowledgeEvent,
    closeEvent,
    catchUpEscalations,
    levelLabel,
    statusLabel,
  }
})

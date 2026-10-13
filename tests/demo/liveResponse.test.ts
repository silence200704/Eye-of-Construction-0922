import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useAlertStore } from '@/stores/alerts'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useRecordsStore } from '@/stores/records'
import { useSessionStore } from '@/stores/session'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { CRACK_SAMPLES, demoSampleTime } from '@/config/demoScript'
import { resolveDemoBase } from '@/stores/writes/demoWrites'
import { loadRecordsScenario } from '@/stores/writes/demo/baseline'
import { loadLiveResponseScenario } from '@/stores/writes/demo/liveResponse'
import { responseStageOf } from '@/core/demo/liveResponse'

const POINT = 'pnt_b03_f2_crack01'

async function seed(): Promise<void> {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.delete()
  await db.open()
  await useArchiveStore().loadSeed()
  await useRecordsStore().reload()
  await useEventsStore().reload()
  await useIssueStore().reload()
  await useWorkOrderStore().reload()
}

describe('红色预警现场处置场景', () => {
  beforeEach(seed)

  it('一键生成待确认的红色事件，保留转问题和派工给现场操作', async () => {
    const out = await loadLiveResponseScenario()
    expect(out.ok).toBe(true)
    expect(out.created).toBe(4)
    expect(out.focus?.query.event).toBeDefined()
    const event = useEventsStore().byId(out.focus?.query.event ?? '')
    expect(event?.status).toBe('pending')
    expect(event?.level).toBe('red')
    expect(event?.evidences.map((row) => row.level)).toEqual(['yellow', 'orange', 'red'])
    expect(event?.upgrades).toHaveLength(2)
    expect(useEventsStore().notificationsOf(event?.id ?? '')).toHaveLength(7)
    expect(useAlertStore().activeStrong?.level).toBe('red')
    expect(useIssueStore().issues.filter((row) => row.eventId === event?.id)).toHaveLength(0)
    expect(useWorkOrderStore().orders.filter((row) => row.eventId === event?.id)).toHaveLength(0)
    expect(responseStageOf({ event, issue: undefined, order: undefined }).action).toBe('确认事件')
  })

  it('重复载入不生成重复数据，可以再次展示红色弹窗', async () => {
    const first = await loadLiveResponseScenario()
    const alert = useAlertStore().activeStrong
    expect(alert).not.toBeNull()
    useAlertStore().dismiss(alert?.key ?? '')

    const second = await loadLiveResponseScenario()
    expect(second.ok).toBe(true)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(4)
    expect(second.focus?.query.event).toBe(first.focus?.query.event)
    expect(useAlertStore().activeStrong?.level).toBe('red')
    expect(useRecordsStore().records.filter((row) => row.note.includes('现场处置演示'))).toHaveLength(4)
  })

  it('同时间已有手工记录时先拒绝，不写出半截预警', async () => {
    const archive = useArchiveStore()
    const rule = archive.ruleFor(POINT, new Date().toISOString())
    const base = resolveDemoBase(rule?.effectiveFrom ?? '', POINT)
    const at = demoSampleTime(CRACK_SAMPLES[0], base)
    const manual = await useRecordsStore().addRecord({
      pointId: POINT,
      deviceId: null,
      values: { width: 0.51 },
      unit: 'mm',
      sampleTime: at,
      sampleWindow: '',
      source: 'manual',
      quality: 'valid',
      qualityNote: '',
      note: '人工实测，请勿改写',
    })
    const out = await loadLiveResponseScenario()
    expect(out.ok).toBe(false)
    expect(out.message).toContain('冲突')
    expect(useRecordsStore().records.filter((row) => row.note.includes('现场处置演示'))).toHaveLength(0)
    expect(useRecordsStore().records.find((row) => row.id === manual.id)?.values.width).toBe(0.51)
  })

  it('已有全链预警时不把恢复待确认事件伪装成待确认', async () => {
    await loadRecordsScenario()
    const count = useRecordsStore().records.length
    const out = await loadLiveResponseScenario()
    expect(out.ok).toBe(false)
    expect(out.message).toContain('重新载入示例校区')
    expect(useRecordsStore().records).toHaveLength(count)
  })

  it('从红色事件确认后，下一动作变为转问题处理', async () => {
    const out = await useDemoScenarioStore().load('liveResponse')
    expect(out.ok).toBe(true)
    expect(useDemoScenarioStore().stateOf('liveResponse').status).toBe('ready')
    const id = out.focus?.query.event ?? ''
    await useEventsStore().acknowledgeEvent(id)
    expect(responseStageOf({ event: useEventsStore().byId(id), issue: undefined, order: undefined }).action)
      .toBe('转问题处理')
  })

  it('非安全管理人员不能确认现场红色事件，安全管理人员确认后留痕', async () => {
    const out = await loadLiveResponseScenario()
    const id = out.focus?.query.event ?? ''
    useSessionStore().setIdentity('演示维修工', 'repair')
    await expect(useEventsStore().acknowledgeEvent(id)).rejects.toThrow('学校安全管理人员')
    expect((await db.events.get(id))?.status).toBe('pending')
    useSessionStore().setIdentity('演示安全员', 'safety')
    await useEventsStore().acknowledgeEvent(id)
    const confirmed = await db.events.get(id)
    expect(confirmed?.status).toBe('handling')
    expect(confirmed?.acknowledgedBy).toBe('演示安全员')
  })

  it('预警转问题并审核后，现场引导从审核推进到派工', async () => {
    const out = await loadLiveResponseScenario()
    const eventId = out.focus?.query.event ?? ''
    await useEventsStore().acknowledgeEvent(eventId)
    const issueResult = await useIssueStore().createIssueFromEvent({
      eventId,
      pointId: POINT,
      buildingId: 'bld_b03',
      floorId: 'flr_b03_02',
      zoneId: '二层走廊',
      anomalyType: '测点支架松动',
      description: '现场复核确认测点支架固定件松动，按设备维修处理；结构异常仍需继续复测。',
      photos: [],
      detail: '现场处置演示：确认测点支架固定件松动',
    })
    const issue = issueResult.issue
    expect(responseStageOf({ event: useEventsStore().byId(eventId), issue, order: undefined }).action)
      .toBe('审核问题')

    const reviewed = await useIssueStore().reviewIssue(issue.id, {
      action: 'to_repair', category: 'equipment', note: '设备固定件已确认松动，安排维修',
    })
    expect(reviewed.ok).toBe(true)
    await useWorkOrderStore().reload()
    const currentIssue = useIssueStore().byId(issue.id)
    const order = useWorkOrderStore().orders.find((row) => row.issueId === issue.id)
    expect(order?.status).toBe('created')
    expect(responseStageOf({ event: useEventsStore().byId(eventId), issue: currentIssue, order }).action)
      .toBe('派工')
    if (order === undefined || currentIssue === undefined) throw new Error('审核后应有关联问题和工单')
    const event = useEventsStore().byId(eventId)
    expect(responseStageOf({ event, issue: currentIssue, order: { ...order, status: 'assigned' } }).action)
      .toBe('接单处理')
    expect(responseStageOf({ event, issue: currentIssue, order: { ...order, status: 'repairing' } }).action)
      .toBe('提交待验收')
    expect(responseStageOf({ event, issue: currentIssue, order: { ...order, status: 'submitted' } }).action)
      .toBe('验收工单')
    expect(responseStageOf({ event, issue: { ...currentIssue, status: 'pending_recheck' }, order: { ...order, status: 'verified' } }).action)
      .toBe('登记复查')
    expect(responseStageOf({ event, issue: { ...currentIssue, status: 'observing' }, order: { ...order, status: 'verified' } }).action)
      .toBe('记录复查结论')
    expect(responseStageOf({ event: event === undefined ? undefined : { ...event, status: 'recovering' }, issue: { ...currentIssue, status: 'closed' }, order: { ...order, status: 'verified' } }).action)
      .toBe('授权关闭事件')
  })
})

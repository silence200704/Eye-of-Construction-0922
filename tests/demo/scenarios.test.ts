/**
 * 演示场景的回归测试：幂等、不覆盖手工数据、各条链的预期结果与全链。
 *
 * 用真实 Dexie 库（fake-indexeddb）+ 真实写入口，所以规则判定、事务与状态机都在测试里跑一遍。
 * 照片在 Node 环境没有画布，`makeDemoPhoto` 返回 null，照片相关步骤自动跳过 —— 这是刻意的，
 * 浏览器里的照片链路另有实测记录，不在单测里假装跑过。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { freshSeed, reloadAll } from './harness'
import { useArchiveStore } from '@/stores/archive'
import { useAlertStore } from '@/stores/alerts'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useRecordsStore } from '@/stores/records'
import { useSessionStore } from '@/stores/session'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import {
  loadAlarmScenario,
  loadAlarmVibScenario,
  loadCampusScenario,
  loadEnvAlarmScenario,
  loadRecordsScenario,
  loadTrendScenario,
} from '@/stores/writes/demo/baseline'
import { loadIssuePoolScenario, loadRecheckScenario } from '@/stores/writes/demo/issue'
import { loadInspectionScenario, loadMaintenanceScenario, loadReportsScenario } from '@/stores/writes/demo/service'
import { loadWorkOrdersScenario } from '@/stores/writes/demo/workOrder'
import { loadFullChain } from '@/stores/writes/demo/chain'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { setArchived } from '@/stores/writes/archiveActions'
import { demoScriptBase, demoSampleTime } from '@/config/demoScript'
import { TILT_SCENARIO } from '@/config/demoScenarioSeries'

describe('演示场景：建档与监测主链', () => {
  beforeEach(async () => {
    await freshSeed()
    await reloadAll()
  })

  it('建档层已有时跳过，不覆盖手工档案', async () => {
    const out = await loadCampusScenario()
    expect(out.ok).toBe(true)
    expect(out.created).toBe(0)
    expect(out.message).toContain('不覆盖手工档案')
  })

  it('裂缝主链生成 8 条记录，并产出事件、证据、升级与通知', async () => {
    const records = useRecordsStore()
    const out = await loadRecordsScenario()
    expect(out.created).toBe(8)
    expect(out.skipped).toBe(0)
    await reloadAll()
    const scripted = records.records.filter((row) => row.note.includes('演示脚本一键导入'))
    expect(scripted).toHaveLength(8)
    expect(scripted.every((row) => row.source === 'device' && row.deviceId === 'dev_b03_f2_crack01')).toBe(true)

    const events = useEventsStore()
    const event = events.sorted.find((row) => row.pointId.includes('crack'))
    expect(event).toBeDefined()
    expect(event?.evidences.length).toBe(3)
    expect(event?.upgrades.length).toBe(2)
    expect(event?.level).toBe('red')
    expect(events.notificationsOf(event?.id ?? '').length).toBe(7)
  })

  it('重复载入按"测点 + 采样时刻"跳过，不重复写记录', async () => {
    await loadRecordsScenario()
    await reloadAll()
    const again = await loadRecordsScenario()
    expect(again.created).toBe(0)
    expect(again.skipped).toBe(8)
    await reloadAll()
    expect(useRecordsStore().records.filter((row) => row.note.includes('演示脚本一键导入')).length).toBe(8)
  })

  it('不覆盖手工录入的记录', async () => {
    const records = useRecordsStore()
    await records.addRecord({
      pointId: 'pnt_b03_f2_vib01',
      deviceId: null,
      values: { accelRms: 0.02, accelPeak: 0.07 },
      unit: 'm/s²',
      sampleTime: new Date(Date.now() - 3600_000).toISOString(),
      sampleWindow: '1 s',
      source: 'manual',
      quality: 'valid',
      qualityNote: '',
      note: '手工录入：不应被演示场景改写',
    })
    await reloadAll()
    await loadRecordsScenario()
    await loadTrendScenario()
    await reloadAll()
    const kept = records.records.find((row) => row.note === '手工录入：不应被演示场景改写')
    expect(kept).toBeDefined()
    expect(kept?.values.accelRms).toBe(0.02)
  })

  it('载入演示数据后预警提醒里出现新建与升级条目，重复载入重放而不是堆重复', async () => {
    const alerts = useAlertStore()
    await loadRecordsScenario()
    const levels = alerts.items.map((row) => row.level)
    expect(levels).toContain('yellow')
    expect(levels).toContain('orange')
    expect(levels).toContain('red')
    // 红色事件按既有规则走强提醒（弹窗）
    const red = alerts.items.find((row) => row.level === 'red')
    expect(red?.strong).toBe(true)
    expect(alerts.activeStrong?.key).toBe(red?.key)

    // 关掉强提醒后再载入一次：条目数不变（不堆重复），但强提醒要能重放
    alerts.dismiss(red?.key ?? '')
    expect(alerts.activeStrong).toBeNull()
    const before = alerts.items.length
    await reloadAll()
    await loadRecordsScenario()
    expect(alerts.items.length).toBe(before)
    expect(alerts.activeStrong?.key).toBe(red?.key)
    expect(alerts.items.filter((row) => row.level === 'red').length).toBe(1)
  })

  it('趋势补数不生成新事件（补值全部低于阈值）', async () => {
    const before = useEventsStore().sorted.length
    const out = await loadTrendScenario()
    expect(out.created).toBe(6)
    await reloadAll()
    expect(useEventsStore().sorted.length).toBe(before)
  })
})

describe('演示场景：两条预警链', () => {
  beforeEach(async () => {
    await freshSeed()
    await reloadAll()
  })

  it('振动链走出持续异常转橙，并按现场核查无需维修关闭', async () => {
    const out = await loadAlarmVibScenario()
    expect(out.created).toBe(7)
    await reloadAll()
    const event = useEventsStore().sorted.find((row) => row.pointId === 'pnt_b03_f2_vib01')
    expect(event).toBeDefined()
    expect(event?.level).toBe('orange')
    expect(event?.status).toBe('closed')
    expect(event?.closeBasis ?? '').not.toBe('')
  })

  it('温湿度越限生成环境提醒，且不产生结构红色预警', async () => {
    const out = await loadEnvAlarmScenario()
    expect(out.created).toBe(3)
    await reloadAll()
    const events = useEventsStore().sorted
    const env = events.find((row) => row.pointId === 'pnt_b03_f2_th01')
    expect(env).toBeDefined()
    // 环境异常只作辅助判断：等级最多到橙，且不会出现红色结构事件
    expect(env?.level).toBe('orange')
    expect(events.filter((row) => row.level === 'red')).toEqual([])
  })

  it('预警场景把站内提醒处理成已确认与已升级未确认两种状态', async () => {
    await loadRecordsScenario()
    await reloadAll()
    const out = await loadAlarmScenario()
    expect(out.ok).toBe(true)
    await reloadAll()
    const events = useEventsStore()
    const event = events.sorted.find((row) => row.pointId.includes('crack'))
    // 脚本一次写完 8 条时事件已进入恢复待确认（事件级确认只接受"待确认"），
    // 所以这里锁定的是"提醒已确认"这件事，而不是事件状态。
    expect(event?.status).toBe('recovering')
    const notices = events.notificationsOf(event?.id ?? '')
    expect(notices.length).toBe(7)
    expect(notices.filter((row) => row.acknowledgedAt !== null).length).toBe(4)
    expect(
      notices.filter((row) => row.escalatedAt !== null && row.acknowledgedAt === null).length,
    ).toBe(3)
  })
})

describe('演示场景：问题、工单、复查、巡检、保养', () => {
  beforeEach(async () => {
    await freshSeed()
    await reloadAll()
  })

  it('六类审核出口全覆盖', async () => {
    const out = await loadIssuePoolScenario()
    expect(out.ok).toBe(true)
    await reloadAll()
    const demo = useIssueStore().issues.filter((row) => row.description.includes('演示场景[问题池'))
    expect(demo.length).toBe(6)
    const actions = demo.map((row) => row.status).sort()
    expect(actions).toContain('repairing')
    expect(actions).toContain('investigating')
    expect(actions).toContain('pending_recheck')
    expect(actions).toContain('pending_review')
    expect(actions.filter((row) => row === 'closed').length).toBe(2)
  })

  it('工单五态齐备，且重复载入不重复建单', async () => {
    const first = await loadWorkOrdersScenario()
    expect(first.ok).toBe(true)
    await reloadAll()
    const orders = useWorkOrderStore().orders
    expect(orders.length).toBe(5)
    const statuses = orders.map((row) => row.status)
    expect(statuses).toContain('created')
    expect(statuses).toContain('repairing')
    expect(statuses).toContain('submitted')
    expect(statuses).toContain('returned')
    expect(statuses).toContain('verified')

    await loadWorkOrdersScenario()
    await reloadAll()
    expect(useWorkOrderStore().orders.length).toBe(5)
  })

  it('复查三态：逾期 / 继续观察开下一轮 / 复发转处置', async () => {
    const out = await loadRecheckScenario()
    expect(out.ok).toBe(true)
    await reloadAll()
    const demo = useIssueStore().issues.filter((row) => row.description.includes('演示场景[复查'))
    expect(demo.length).toBe(3)
    const observing = demo.find((row) => row.description.includes('继续观察'))
    expect((observing?.rechecks ?? []).length).toBe(2)
    expect(observing?.status).toBe('observing')
    const recurred = demo.find((row) => row.description.includes('复发'))
    expect(recurred?.status).toBe('pending_review')
  })

  it('巡检生成今日任务并完成一次模拟签到', async () => {
    const out = await loadInspectionScenario()
    expect(out.ok).toBe(true)
    expect(out.anchors.length).toBe(1)
  })

  it('保养：计划 + 今日待执行 + 已完成 + 逾期 + 异常转问题', async () => {
    const out = await loadMaintenanceScenario()
    expect(out.ok).toBe(true)
    await reloadAll()
    const tasks = useMaintenanceTaskStore().tasks
    expect(tasks.length).toBe(4)
    expect(tasks.filter((row) => row.status === 'done').length).toBe(2)
    expect(tasks.filter((row) => row.status === 'pending').length).toBe(2)
    const issues = useIssueStore().issues.filter((row) => row.source === 'maintenance')
    expect(issues.length).toBe(1)
    // 保养异常绝不生成结构预警事件
    expect(useEventsStore().sorted.length).toBe(0)
  })

  it('报表场景只读', async () => {
    const out = await loadReportsScenario()
    expect(out.ok).toBe(true)
    expect(out.created).toBe(0)
  })
})

describe('演示场景：状态与失败处理', () => {
  beforeEach(async () => {
    await freshSeed()
    await reloadAll()
  })

  it('重载示例校区后，写数据场景标记为"数据已失效"', async () => {
    const store = useDemoScenarioStore()
    await store.load('records')
    expect(store.stateOf('records').status).toBe('ready')

    await useArchiveStore().loadSeed()
    await store.refresh()
    expect(store.stateOf('records').status).toBe('stale')
    // 建档场景不受影响：它自己就是数据源
    expect(store.stateOf('campus').status === 'ready' || store.stateOf('campus').status === 'idle').toBe(true)
  })

  it('载入失败时登记为失败，不显示成已就绪', async () => {
    // 空库（没有裂缝测点）时主链会直接报错
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
    const store = useDemoScenarioStore()
    const out = await store.load('records')
    expect(out.ok).toBe(false)
    expect(store.stateOf('records').status).toBe('failed')
    expect(store.stateOf('records').ready).toBe(false)
  })

  it('前置失败时后续依赖步骤不再执行', async () => {
    // 归档掉裂缝测点 → 主链无法生成 → 依赖它的裂缝预警场景应被跳过
    await setArchived('point', 'pnt_b03_f2_crack01', true, '演示场景测试：临时归档')
    await reloadAll()
    const out = await loadFullChain()
    expect(out.results.find((row) => row.key === 'records')?.ok).toBe(false)
    const alarm = out.results.find((row) => row.key === 'alarm')
    expect(alarm?.ok).toBe(false)
    expect(alarm?.message).toContain('跳过')
    // 不依赖主链的场景照常完成
    expect(out.results.find((row) => row.key === 'issuePool')?.ok).toBe(true)
  })

  it('与手工数据冲突时明确提示，不静默跳过', async () => {
    const records = useRecordsStore()
    // 在趋势场景要写的时刻上放一条手工记录
    const base = demoScriptBase()
    const clash = demoSampleTime(TILT_SCENARIO.samples[0], base)
    await records.addRecord({
      pointId: TILT_SCENARIO.pointId,
      deviceId: null,
      values: { angleX: 0.01, angleY: 0 },
      unit: '°',
      sampleTime: clash,
      sampleWindow: '',
      source: 'manual',
      quality: 'valid',
      qualityNote: '',
      note: '手工录入：占住这个采样时刻',
    })
    await reloadAll()
    const out = await loadTrendScenario()
    expect(out.message).toContain('冲突')
    await reloadAll()
    const kept = records.records.find((row) => row.note === '手工录入：占住这个采样时刻')
    expect(kept?.values.angleX).toBe(0.01)
  })
  it('连续点击两个场景：载入任务串行，数据都会写进去且身份不乱', async () => {
    const store = useDemoScenarioStore()
    const [a, b] = await Promise.all([store.load('records'), store.load('trend')])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    // 两次载入都落库了（没有互相覆盖），身份也还原成原来的
    await reloadAll()
    expect(useRecordsStore().records.filter((row) => row.note.includes('演示脚本一键导入')).length).toBe(8)
    expect(useRecordsStore().records.filter((row) => row.note.includes('演示场景导入：倾角')).length).toBe(3)
    expect(useSessionStore().name).toBe('演示操作员')
  })

  it('关键对象被手工删掉后显示"数据已失效"', async () => {
    const store = useDemoScenarioStore()
    await store.load('records')
    expect(store.stateOf('records').status).toBe('ready')

    // 把该场景锚定的那个事件删掉（模拟手工清理）
    const events = useEventsStore()
    const event = events.sorted.find((row) => row.pointId.includes('crack'))
    await db.events.delete(event?.id ?? '')
    await events.reload()
    expect(store.stateOf('records').status).toBe('stale')
  })

  it('审计日志写不进去时，失败状态仍然保存', async () => {
    const store = useDemoScenarioStore()
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
    // 让审计日志写入失败：模拟"库不可写"
    const spy = vi.spyOn(db.audits, 'put').mockRejectedValue(new Error('审计表不可写'))
    const out = await store.load('records')
    spy.mockRestore()
    expect(out.ok).toBe(false)
    expect(store.stateOf('records').status).toBe('failed')
  })

  it('全链跑完后每个模块都显示已就绪，并给出闭环编号', async () => {
    const store = useDemoScenarioStore()
    const out = await store.loadChain()
    expect(out.results.length).toBe(14)
    expect(store.stateOf('records').status).toBe('ready')
    expect(store.stateOf('maintenance').status).toBe('ready')
    expect(store.stateOf('issuePool').status).toBe('ready')
    expect(out.chainOk).toBe(true)
    expect(out.chainLine).toContain('复查第 1 轮')
  })
})


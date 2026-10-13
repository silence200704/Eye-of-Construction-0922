/**
 * 基础场景：建档、监测主链、趋势补数、两条预警链。
 *
 * 全部走既有仓储入口：`runDemoScript`（记录 8 条 + 事件 + 通知）、`records.addRecord`、
 * `events.acknowledgeEvent`、`events.closeEvent`。本文件不直接写库、不写状态结果。
 */
import { CRACK_SAMPLES, demoScriptBase, demoSampleTime } from '@/config/demoScript'
import {
  ENV_ALARM_SCENARIO,
  ENV_SCENARIO,
  TILT_SCENARIO,
  TREND_SCENARIOS,
  VIB_CLOSE_BASIS,
  VIB_EVENT_SCENARIO,
  VIB_NO_REPAIR_NOTE,
  type ScenarioSeries,
} from '@/config/demoScenarioSeries'
import { EVENT_STATUS_LABEL } from '@/types/events'
import { fromLocalInput, nowIso, todayInput } from '@/core/time'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useRecordsStore } from '@/stores/records'
import { resolveDemoBase, runDemoScript, simulateOverdueNotifications } from '@/stores/writes/demoWrites'
import {
  alertNote,
  dayKeyOffset,
  isDemoRecord,
  logScenario,
  makeResult,
  presentLoadedAlerts,
  withActor,
  type DemoScenarioResult,
} from './support'

const NOTE_PREFIX = '演示场景导入'

/** 同测点、同采样时刻已存在的那条记录（没有则 undefined）。 */
function findRecord(pointId: string, sampleTime: string) {
  const records = useRecordsStore()
  return records.records.find((row) => row.pointId === pointId && row.sampleTime === sampleTime)
}

/** 与手工数据冲突的条数：跳过可以，但不能静默 —— 界面上要说清"这里已有非演示数据"。 */
function conflictNote(conflicts: number): string {
  return conflicts === 0
    ? ''
    : `；其中 ${conflicts} 条与既有非演示记录时间冲突，已跳过、未改写`
}

interface SeriesCounter {
  created: number
  skipped: number
  conflicts: number
}

/** 逐条写入一条序列，返回新增、跳过与冲突条数。 */
async function writeSeries(
  series: ScenarioSeries,
  base: Date,
  counter: SeriesCounter,
): Promise<void> {
  const records = useRecordsStore()
  for (const sample of series.samples) {
    const sampleTime = demoSampleTime(sample, base)
    const existing = findRecord(series.pointId, sampleTime)
    if (existing !== undefined) {
      counter.skipped += 1
      if (!isDemoRecord(existing.note)) counter.conflicts += 1
      continue
    }
    await records.addRecord({
      pointId: series.pointId,
      deviceId: series.deviceId,
      values: sample.values,
      unit: series.unit,
      sampleTime,
      sampleWindow: series.window,
      source: 'device',
      quality: 'valid',
      qualityNote: '',
      note: `${NOTE_PREFIX}：${sample.label}`,
    })
    counter.created += 1
  }
}

/** 示例校区建档：只在建档层为空时重建，绝不覆盖手工档案。 */
export async function loadCampusScenario(): Promise<DemoScenarioResult> {
  const key = 'campus' as const
  const archive = useArchiveStore()
  const active = archive.buildings.filter((row) => row.status === 'active')
  if (active.length > 0) {
    const message = `建档层已有 ${active.length} 栋在册楼栋，本场景不覆盖手工档案（跳过）`
    await logScenario(key, '示例校区建档', message)
    return makeResult(key, true, message, { skipped: active.length })
  }
  await archive.loadSeed()
  const message = '已重建示例校区：4 栋楼 / 8 个楼层 / 8 个测点 / 4 台设备 / 2 条基准 / 8 条监测记录'
  await logScenario(key, '示例校区建档', message)
  return makeResult(key, true, message, { created: 1, anchors: ['B03 3号教学楼'] })
}

/** 监测数据：裂缝主链 8 条，事件与通知由规则判定真实生成。 */
export async function loadRecordsScenario(): Promise<DemoScenarioResult> {
  const key = 'records' as const
  const archive = useArchiveStore()
  // 幂等靠内存里的记录做比对，先重读一次：否则会把已存在的行当成不存在，重复写一遍
  await useRecordsStore().reload()
  await useEventsStore().reload()
  const out = await runDemoScript()

  /*
   * 与手工数据的冲突：期望写入的采样时刻已被**非演示**记录占用。
   * runDemoScript 只会静默跳过，这里按同一基准复算一次，把冲突条数报到界面上。
   */
  const pointId = crackPointId()
  const rule = pointId === '' ? undefined : archive.ruleFor(pointId, nowIso())
  const base = resolveDemoBase(rule?.effectiveFrom ?? '', pointId)
  const conflicts = CRACK_SAMPLES.filter((sample) => {
    const row = findRecord(pointId, demoSampleTime(sample, base))
    return row !== undefined && !isDemoRecord(row.note)
  }).length

  await useEventsStore().reload()
  const touched = useEventsStore().sorted.find((row) => row.eventNo === out.eventNo)
  const alerts = touched === undefined ? { added: 0, reopened: 0 } : presentLoadedAlerts([touched])
  const message =
    `裂缝主链：新增 ${out.created} 条、跳过 ${out.skipped} 条${conflictNote(conflicts)}；` +
    `事件 ${out.eventNo === '' ? '无（未越限）' : out.eventNo}、证据 ${out.evidences} 条、升级 ${out.upgrades} 次、通知 ${out.notifications} 条；` +
    alertNote(alerts)
  await logScenario(key, '监测数据（裂缝主链）', message)
  return makeResult(key, true, message, {
    created: out.created,
    skipped: out.skipped,
    anchors: out.eventNo === '' ? [] : [out.eventNo],
    ...(touched === undefined ? {} : { anchorRefs: [{ kind: 'event' as const, id: touched.id }] }),
  })
}

/** 趋势补数：倾角与温湿度各 3 条，全部低于阈值，不生成事件。 */
export async function loadTrendScenario(): Promise<DemoScenarioResult> {
  const key = 'trend' as const
  await useRecordsStore().reload()
  const base = demoScriptBase()
  const counter: SeriesCounter = { created: 0, skipped: 0, conflicts: 0 }
  for (const series of TREND_SCENARIOS) {
    await writeSeries(series, base, counter)
  }
  const message =
    `趋势补数：新增 ${counter.created} 条、跳过 ${counter.skipped} 条${conflictNote(counter.conflicts)}；` +
    `倾角（${TILT_SCENARIO.samples.length} 条，最高 0.08°，未越限）与温湿度（${ENV_SCENARIO.samples.length} 条，正常）`
  await logScenario(key, '监测趋势（补其他测点）', message)
  return makeResult(key, true, message, { created: counter.created, skipped: counter.skipped })
}

/** 演示脚本作用的裂缝测点：取第一个有适用裂缝规则的测点。 */
function crackPointId(): string {
  const archive = useArchiveStore()
  const at = nowIso()
  const point = archive.activePoints.find((row) => archive.ruleFor(row.id, at)?.metric === 'crack_width')
  return point?.id ?? ''
}

/** 预警确认：确认主链生成的事件与站内提醒，并报告证据 / 升级 / 通知条数。 */
export async function loadAlarmScenario(): Promise<DemoScenarioResult> {
  const key = 'alarm' as const
  const archive = useArchiveStore()
  const events = useEventsStore()
  await events.reload()

  const pointId = crackPointId()
  if (pointId === '') return makeResult(key, false, '示例数据里没有裂缝测点，无法定位预警事件')
  const rule = archive.ruleFor(pointId, nowIso())
  if (rule === undefined) return makeResult(key, false, '裂缝测点当前没有适用规则，请先载入示例校区')

  const open = events.openEventOf(pointId, rule.ruleId)
  if (open === undefined) {
    const closed = events.sorted.find(
      (row) => row.pointId === pointId && row.ruleId === rule.ruleId && row.status === 'closed',
    )
    const message =
      closed === undefined
        ? '该测点当前没有越限事件：请先载入「监测数据（裂缝主链）」再确认'
        : `裂缝事件 ${closed.eventNo} 已关闭（关闭依据已留痕），没有待确认动作；` +
          '要重新演示升级过程，请到系统设置清空本机数据，再用唯一入口载入全链演示数据'
    await logScenario(key, '预警事件（工单验收后关闭）', message)
    return makeResult(key, true, message, { anchors: closed === undefined ? [] : [closed.eventNo] })
  }

  if (open.status === 'pending') await withActor('safety', async () => events.acknowledgeEvent(open.id))

  // 让预警提醒里同时有"已确认"和"已升级未确认"两种状态：
  // 先按演示策略把未确认的提醒标记为超时升级，再由人确认其中 4 条。
  // 升级调的是既有演示入口（escalationSource = 'demo'），真实系统按黄 30 / 橙 10 / 红 5 分钟判定。
  const unacked = events.notificationsOf(open.id).filter((row) => row.acknowledgedAt === null)
  const escalated =
    unacked.length === 0
      ? 0
      : (await withActor('safety', async () => simulateOverdueNotifications(open.id))).escalated
  const toConfirm = events
    .notificationsOf(open.id)
    .filter((row) => row.escalatedAt !== null && row.acknowledgedAt === null)
    .slice(0, 4)
  for (const row of toConfirm) {
    await withActor('safety', async () => events.acknowledgeNotification(row.id))
  }

  const after = events.byId(open.id) ?? open
  /*
   * 预警中心页的「载入演示数据」也要弹红色强提醒。
   * 原来只有记录类场景（监测主链 / 振动 / 环境）会呈现提醒，这一条没有 ——
   * 于是站在预警中心点按钮时"什么都不弹"，与预期不一致。
   */
  const alerts = presentLoadedAlerts([after])
  const notices = events.notificationsOf(after.id)
  const confirmed = notices.filter((row) => row.acknowledgedAt !== null).length
  const escalatedLeft = notices.filter((row) => row.escalatedAt !== null && row.acknowledgedAt === null).length
  const message =
    `事件 ${after.eventNo}：状态 ${EVENT_STATUS_LABEL[after.status]}；` +
    `证据 ${after.evidences.length} 条、升级 ${after.upgrades.length} 次、` +
    `通知 ${notices.length} 条（已确认 ${confirmed}、已升级未确认 ${escalatedLeft}；` +
    `本次按演示策略标记超时升级 ${escalated} 条）；${alertNote(alerts)}` +
    (after.status === 'pending'
      ? '；已记录确认人与时间'
      : '；脚本一次写完 8 条时事件已进入恢复待确认，事件级确认需在事件仍为"待确认"时操作')
  await logScenario(key, '预警事件（工单验收后关闭）', message)
  return makeResult(key, true, message, {
    anchors: [after.eventNo],
    focus: { path: '/alarms', query: { event: after.id } },
    anchorRefs: [{ kind: 'event', id: after.id }],
  })
}

/**
 * 温湿度环境提醒：给预警提醒补另一类通知，并演示"环境异常不生成结构红色预警"。
 * 与振动同理锚在"运行日 −1 天"，保证落在示例校区自带的两条固定日期温湿度记录之后。
 */
export async function loadEnvAlarmScenario(): Promise<DemoScenarioResult> {
  const key = 'envAlarm' as const
  const archive = useArchiveStore()
  const events = useEventsStore()
  await useRecordsStore().reload()
  const anchorKey = dayKeyOffset(-1, todayInput())
  const anchor = new Date(fromLocalInput(`${anchorKey}T00:00`))
  const counter: SeriesCounter = { created: 0, skipped: 0, conflicts: 0 }

  await writeSeries(
    {
      pointId: ENV_ALARM_SCENARIO.pointId,
      deviceId: ENV_ALARM_SCENARIO.deviceId,
      unit: ENV_ALARM_SCENARIO.unit,
      window: ENV_ALARM_SCENARIO.window,
      samples: ENV_ALARM_SCENARIO.samples,
    },
    anchor,
    counter,
  )

  await events.reload()
  const rule = archive.ruleFor(ENV_ALARM_SCENARIO.pointId, nowIso())
  const open = rule === undefined ? undefined : events.openEventOf(ENV_ALARM_SCENARIO.pointId, rule.ruleId)
  const notices = open === undefined ? 0 : events.notificationsOf(open.id).length
  const alerts = open === undefined ? { added: 0, reopened: 0 } : presentLoadedAlerts([open])
  const message =
    `温湿度越限：新增 ${counter.created} 条、跳过 ${counter.skipped} 条${conflictNote(counter.conflicts)}；` +
    (open === undefined
      ? '本次未生成环境提醒'
      : `环境提醒 ${open.eventNo}（${EVENT_STATUS_LABEL[open.status]}）、通知 ${notices} 条`) +
    `；${alertNote(alerts)}；环境异常只作辅助判断，不生成结构红色预警`
  await logScenario(key, '温湿度环境提醒（不生成结构预警）', message)
  return makeResult(key, true, message, {
    created: counter.created,
    skipped: counter.skipped,
    anchors: open === undefined ? [] : [open.eventNo],
    ...(open === undefined
      ? {}
      : {
          focus: { path: '/alarms', query: { event: open.id } },
          anchorRefs: [{ kind: 'event' as const, id: open.id }],
        }),
  })
}

/**
 * 振动预警事件：绝对判定 + 持续异常升橙，再用**现场核查无需维修**关闭。
 * 整段锚在"运行日 −2 天"，保证落在示例校区自带的两条固定日期振动记录之后。
 */
export async function loadAlarmVibScenario(): Promise<DemoScenarioResult> {
  const key = 'alarmVib' as const
  const archive = useArchiveStore()
  const events = useEventsStore()
  await useRecordsStore().reload()
  const anchorKey = dayKeyOffset(-2, todayInput())
  const anchor = new Date(fromLocalInput(`${anchorKey}T00:00`))
  const counter: SeriesCounter = { created: 0, skipped: 0, conflicts: 0 }

  await writeSeries(
    { pointId: VIB_EVENT_SCENARIO.pointId, deviceId: VIB_EVENT_SCENARIO.deviceId, unit: VIB_EVENT_SCENARIO.unit, window: VIB_EVENT_SCENARIO.window, samples: VIB_EVENT_SCENARIO.samples },
    anchor,
    counter,
  )

  await events.reload()
  const rule = archive.ruleFor(VIB_EVENT_SCENARIO.pointId, nowIso())
  if (rule === undefined) return makeResult(key, false, '振动测点当前没有适用规则，请先载入示例校区')
  const open = events.openEventOf(VIB_EVENT_SCENARIO.pointId, rule.ruleId)

  let closedNo = ''
  let tail = ''
  if (open !== undefined && open.status === 'recovering') {
    try {
      await withActor('safety', async () =>
        events.closeEvent(open.id, { basis: VIB_CLOSE_BASIS, noRepairNote: VIB_NO_REPAIR_NOTE }),
      )
      closedNo = open.eventNo
      tail = '；已按「现场核查无需维修」关闭'
    } catch (cause) {
      tail = `；关闭未成功：${cause instanceof Error ? cause.message : String(cause)}`
    }
  } else if (open !== undefined) {
    tail = `；事件当前是 ${EVENT_STATUS_LABEL[open.status]}，还没到"恢复待确认"，未执行关闭`
  }

  const message =
    `振动序列：新增 ${counter.created} 条、跳过 ${counter.skipped} 条${conflictNote(counter.conflicts)}` +
    `${open === undefined ? '（本次未生成事件）' : `；事件 ${open.eventNo}`}${tail}` +
    `；${alertNote(open === undefined ? { added: 0, reopened: 0 } : presentLoadedAlerts([open]))}`
  await logScenario(key, '振动预警事件（现场核查无需维修后关闭）', message)
  const anchors = closedNo === '' ? (open === undefined ? [] : [open.eventNo]) : [closedNo]
  return makeResult(key, true, message, {
    created: counter.created,
    skipped: counter.skipped,
    anchors,
    ...(open === undefined
      ? {}
      : {
          focus: { path: '/alarms', query: { event: open.id } },
          anchorRefs: [{ kind: 'event' as const, id: open.id }],
        }),
  })
}

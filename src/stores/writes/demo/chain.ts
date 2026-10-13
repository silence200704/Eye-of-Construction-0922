/**
 * 全链演示场景：按"建档 → 监测 → 预警 → 问题 → 工单 → 复查 → 巡检 → 保养 → 报表"顺序
 * 依次调用各模块场景（不另写一套逻辑，保证单模块与全链结果一致），最后写一条汇总日志。
 */
import type { DemoScenarioKey } from '@/config/demoScenarios'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useClockStore } from '@/stores/clock'
import { logScenario, makeResult, type DemoScenarioResult } from './support'
import {
  loadAlarmScenario,
  loadAlarmVibScenario,
  loadCampusScenario,
  loadEnvAlarmScenario,
  loadRecordsScenario,
  loadTrendScenario,
} from './baseline'
import { loadIssuePoolScenario, loadRecheckScenario } from './issue'
import { loadWorkOrdersScenario } from './workOrder'
import { loadInspectionScenario, loadMaintenanceScenario, loadReportsScenario } from './service'
import { loadLiveResponseScenario } from './liveResponse'
import { loadMediaEvidenceScenario } from './mediaEvidence'
import { loadSimulatedLiveSensors, normalizeLegacyDemoSensors } from './liveSensors'
import { loadCoverageScenario } from './coverage'
import { P_CRACK } from '@/db/seedFactories'

/** 场景键 → 载入动作。全链与单模块共用同一批实现。 */
export const SCENARIO_LOADERS: Record<DemoScenarioKey, () => Promise<DemoScenarioResult>> = {
  campus: loadCampusScenario,
  records: loadRecordsScenario,
  trend: loadTrendScenario,
  alarm: loadAlarmScenario,
  alarmVib: loadAlarmVibScenario,
  envAlarm: loadEnvAlarmScenario,
  inspection: loadInspectionScenario,
  issuePool: loadIssuePoolScenario,
  workOrders: loadWorkOrdersScenario,
  recheck: loadRecheckScenario,
  maintenance: loadMaintenanceScenario,
  reports: loadReportsScenario,
  liveResponse: loadLiveResponseScenario,
  mediaEvidence: () => loadMediaEvidenceScenario({ pointId: P_CRACK }),
  coverage: loadCoverageScenario,
}

/** 全链顺序：先建档再出数据，问题与工单在预警之后，报表放最后。 */
export const FULL_CHAIN_ORDER: DemoScenarioKey[] = [
  'campus',
  'records',
  'trend',
  'alarm',
  'alarmVib',
  'envAlarm',
  'inspection',
  'issuePool',
  'workOrders',
  'recheck',
  'maintenance',
  'coverage',
  'reports',
  // 素材类场景放最后：它只登记"素材已就绪"，不写业务表，但要求数据集里已经有裂缝测点
  'mediaEvidence',
]

/**
 * 前置依赖：前置没成功时后续步骤**不再执行**。
 * 拿着半截数据继续往下写，只会得到一批"看起来成功、其实接不上"的记录。
 * 建档是全部写数据场景的地基；裂缝预警还要先有监测主链。
 */
export const FULL_CHAIN_DEPS: Partial<Record<DemoScenarioKey, DemoScenarioKey[]>> = {
  records: ['campus'],
  trend: ['campus'],
  alarm: ['records'],
  alarmVib: ['campus'],
  envAlarm: ['campus'],
  inspection: ['campus'],
  issuePool: ['campus'],
  workOrders: ['campus'],
  recheck: ['campus'],
  maintenance: ['campus'],
  reports: ['campus'],
  mediaEvidence: ['campus'],
  coverage: ['campus', 'records'],
}

export interface FullChainOutcome {
  results: DemoScenarioResult[]
  created: number
  skipped: number
  message: string
  /** 业务链完整性核验结果：一条可核对的闭环编号 */
  chainLine: string
  chainOk: boolean
  liveOk: boolean
}

/**
 * 全链业务链完整性核验：预警 → 问题 → 工单 → 验收 → 复查 是否**真的串在一起**。
 * 每个模块各自成功不等于它们相互关联 —— 这里读实际数据把闭环走一遍，把编号串成一行给评委点开核对。
 */
export function verifyBusinessChain(): { ok: boolean; line: string; missing: string[] } {
  const events = useEventsStore()
  const issues = useIssueStore()
  const orders = useWorkOrderStore()
  const event = events.sorted.find((row) => issues.issues.some((issue) => issue.eventId === row.id))
  if (event === undefined) return { ok: false, line: '', missing: ['由事件转出的问题'] }
  const issue = issues.issues.find((row) => row.eventId === event.id)
  if (issue === undefined) return { ok: false, line: event.eventNo, missing: ['由该事件转出的问题'] }
  const order = issue.workOrderIds
    .map((id) => orders.byId(id))
    .find((row) => row !== undefined && row.status === 'verified' && row.issueId === issue.id && row.eventId === event.id)
  if (order === undefined) {
    return { ok: false, line: `${event.eventNo} → ${issue.issueNo}`, missing: ['已验收通过的工单'] }
  }
  const rounds = issue.rechecks ?? []
  const latest = rounds[rounds.length - 1]
  if (latest === undefined) {
    return {
      ok: false,
      line: `${event.eventNo} → ${issue.issueNo} → ${order.orderNo}`,
      missing: ['复查登记'],
    }
  }
  const state = latest.outcome === null ? '已登记待复查' : ({ recovered: '确认恢复', observing: '继续观察', recurred: '复发转处置' }[latest.outcome])
  return {
    ok: true,
    line: `${event.eventNo} → ${issue.issueNo} → ${order.orderNo} → 复查第 ${rounds.length} 轮（${state}）`,
    missing: [],
  }
}

/** 依次跑完全链；某一步失败后，依赖它的后续步骤标记为"跳过（前置失败）"。 */
export async function loadFullChain(): Promise<FullChainOutcome> {
  const results: DemoScenarioResult[] = []
  const blocked = new Set<DemoScenarioKey>()
  for (const key of FULL_CHAIN_ORDER) {
    const missed = (FULL_CHAIN_DEPS[key] ?? []).filter((dep) => blocked.has(dep))
    if (missed.length > 0) {
      blocked.add(key)
      results.push(
        makeResult(key, false, `跳过：前置 ${missed.join('、')} 未成功，不再拿着半截数据继续写`),
      )
      continue
    }
    try {
      const out = await SCENARIO_LOADERS[key]()
      results.push(out)
      if (!out.ok) blocked.add(key)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      blocked.add(key)
      results.push(makeResult(key, false, `载入失败：${reason}`))
    }
  }
  let live = { created: 0, skipped: 0 }
  let liveError = ''
  let normalized = 0
  if (['campus', 'records', 'trend', 'alarmVib', 'envAlarm'].some((key) => blocked.has(key as DemoScenarioKey))) {
    liveError = '前置监测场景未完成，未追加模拟实时采样'
  } else {
    try {
      normalized = await normalizeLegacyDemoSensors()
      live = await loadSimulatedLiveSensors()
      useClockStore().refresh()
    } catch (cause) {
      liveError = cause instanceof Error ? cause.message : String(cause)
    }
  }
  const created = results.reduce((sum, row) => sum + row.created, live.created)
  const skipped = results.reduce((sum, row) => sum + row.skipped, live.skipped)
  const failed = results.filter((row) => !row.ok)
  // 最后核验业务链是否真的连起来（各模块成功 ≠ 相互关联）
  const chain = verifyBusinessChain()
  const message =
    `全链演示数据：${results.length} 个场景，新增 ${created} 项、跳过 ${skipped} 项` +
    (failed.length === 0 && liveError === '' ? '；全部成功' : `；${failed.length} 个场景未完成（见下表）}`) +
    (liveError === ''
      ? `；近期传感器演示采样新增 ${live.created} 条、跳过 ${live.skipped} 个测点，旧演示来源校正 ${normalized} 条（预设数据，非真实设备上报）`
      : `；模拟实时采样未完成：${liveError}`) +
    `；业务链核验 ${chain.ok ? '通过' : `未通过（缺 ${chain.missing.join('、')}）`}`
  await logScenario(
    'fullChain',
    '全链演示数据',
    `${message}${chain.line === '' ? '' : `；闭环：${chain.line}`}`,
    `按顺序生成：${FULL_CHAIN_ORDER.join(' → ')}；可重复点击，按既有业务键幂等`,
  )
  return { results, created, skipped, message, chainLine: chain.line, chainOk: chain.ok, liveOk: liveError === '' }
}

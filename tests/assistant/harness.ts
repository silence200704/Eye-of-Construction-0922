/**
 * 问筑瞳测试搭台。
 *
 * 刻意走**真实路径**：fake-indexeddb + Pinia + 现有 store，再用公开入口 `askZhutong` 提问。
 * 只桩掉"现在"这一刻（直接给 `clock.nowKey` 一个固定值），
 * 让新鲜度、间隔文案与补录判定可断言 —— 否则"距今几小时"这类断言过一小时就红。
 *
 * 注意：入口**不推进时钟**（第二步闸门），所以钉住的刻度在一次提问后必须原样不动，
 * 这一点由 `clock.test.ts` 单独守着。
 */
import { createPinia, setActivePinia } from 'pinia'
import { askZhutong } from '@/assistant/ask'
import type { AskContext, AskResult } from '@/assistant/types'
import { db } from '@/db/database'
import { writeDataset } from '@/db/repo'
import { useArchiveStore } from '@/stores/archive'
import { useClockStore } from '@/stores/clock'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useRecordsStore } from '@/stores/records'
import type { Baseline, Building, Device, Floor, MonitorRecord, Point } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'
import type { MonitoringRule } from '@/types/rules'
import { makeBaseline, makeBuilding, makeDevice, makeFloor, makePoint, makeRecord, makeRule } from '../fixtures'

/** 测试里的"现在"：固定值，避免时间推移让断言变红。 */
export const NOW = '2026-09-20T12:00:00.000Z'
export const TODAY = '2026-09-20'

export interface Harness {
  archive: ReturnType<typeof useArchiveStore>
  records: ReturnType<typeof useRecordsStore>
  events: ReturnType<typeof useEventsStore>
  issues: ReturnType<typeof useIssueStore>
  workOrders: ReturnType<typeof useWorkOrderStore>
  clock: ReturnType<typeof useClockStore>
  ask: (question: string, context?: AskContext) => Promise<AskResult>
}

export interface DatasetInput {
  buildings?: Building[]
  floors?: Floor[]
  points?: Point[]
  devices?: Device[]
  baselines?: Baseline[]
  records?: MonitorRecord[]
  rules?: MonitoringRule[]
  events?: AlarmEvent[]
  issues?: InspectionIssue[]
  workOrders?: WorkOrder[]
}

/** 最小可用数据集：一栋楼、一层、一个裂缝测点、一台设备、一条基准、一条规则。 */
export async function setupHarness(input: DatasetInput = {}): Promise<Harness> {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  await writeDataset({
    buildings: input.buildings ?? [makeBuilding()],
    floors: input.floors ?? [makeFloor()],
    points: input.points ?? [makePoint()],
    devices: input.devices ?? [makeDevice()],
    baselines: input.baselines ?? [makeBaseline()],
    records: input.records ?? [],
    audits: [],
    rules: input.rules ?? [makeRule()],
    events: input.events ?? [],
    notifications: [],
    plans: [],
    tasks: [],
    issues: input.issues ?? [],
    workOrders: input.workOrders ?? [],
    attachments: [],
    maintenancePlans: [],
    maintenanceTasks: [],
  })
  const archive = useArchiveStore()
  const records = useRecordsStore()
  const events = useEventsStore()
  const issues = useIssueStore()
  const workOrders = useWorkOrderStore()
  await archive.reload()
  await records.load()
  await events.load()
  await issues.reload()
  await workOrders.reload()
  const clock = useClockStore()
  clock.nowKey = NOW
  clock.todayKey = TODAY
  return {
    archive,
    records,
    events,
    issues,
    workOrders,
    clock,
    ask: (question, context) => askZhutong(question, { context }),
  }
}

/** 一条按采样时间排好的记录，默认有效、非补录。 */
export function record(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return makeRecord(overrides)
}

/**
 * 回答里"断言"的部分：结论 + 关键数值。
 * 这两处是用户直接读的信源，不许出现无依据的说法（例如没数据却说"正常"）。
 */
export function claims(result: AskResult): string {
  return [result.conclusion, ...result.facts.map((row) => `${row.label}=${row.value}${row.unit}`)].join('\n')
}

/** 回答里"解释口径"的部分：空态说明、数据口径与时间说明。 */
export function notes(result: AskResult): string {
  const timing = result.timing === null ? [] : [result.timing.freshnessLabel]
  return [...result.gaps, ...result.dataNotes, ...timing].join('\n')
}

/** 断言用：把回答拼成一段纯文本。 */
export function flatten(result: AskResult): string {
  return `${claims(result)}\n${notes(result)}`
}

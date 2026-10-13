/**
 * 选择器门面：半屏界面与回答模板只从这里取数。
 * 新增选择器时先想清楚它属于哪一类（读数 / 事件 / 概况），不要在这个文件里堆实现。
 */
export type { AssistantSnapshot, DeviceRef, IssueRef } from './snapshot'
export {
  buildSnapshot,
  devicesOfPoint,
  ensureStoresLoaded,
  findEvent,
  findPoint,
  issuesOfEvent,
  reloadGuideSources,
} from './snapshot'

export {
  READING_FRESH_MINUTES,
  deltasOf,
  factsOf,
  freshnessOf,
  humanGap,
  latestAnyRecord,
  latestValidRecord,
  recordsOfPoint,
  timingOf,
} from './records'

export {
  bySeverity,
  eventCandidates,
  evidenceFacts,
  evidenceRefs,
  findEventByNo,
  lastClosedEventOfPoint,
  levelText,
  openEvents,
  openEventsByLevel,
  openEventsOfPoint,
  supportingEvidence,
  upgradeChain,
} from './events'

export type { OverviewCounts } from './overview'
export { overviewOf, readingCountsOf } from './overview'

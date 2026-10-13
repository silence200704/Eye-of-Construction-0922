/**
 * 问筑瞳（本地只读问答底座）对外入口。
 *
 * 半屏界面只从这里取三样东西：
 * - `askZhutong(question, options)`：唯一的只读问答调用入口；
 * - 稳定结果类型 `AskResult` 及其子类型；
 * - `ASK_EXAMPLES` 固定问法示例，以及 `buildLink()` 导航白名单与 `pendingCommands()` 待确认指令清单。
 *
 * 例：
 * ```ts
 * import { askZhutong, ASK_EXAMPLES } from '@/assistant'
 * const result = await askZhutong('为什么这条是红色', { context: { eventId: event.id } })
 * // result.status === 'answered' → 渲染 conclusion / facts / timing / provenance / evidence
 * // result.links → 已是 path + query，界面直接 router.push
 * // result.pendingCommands → 只有已登记的红色演示指令可进入人工确认弹窗
 * ```
 */
export { askZhutong, type AskOptions } from './ask'
export { ASK_EXAMPLES } from './answers'
export { NAV_WHITELIST, buildLink, pendingCommands, type NavSpec } from './actions'

export type {
  AskCandidate,
  AskContext,
  AskEvidence,
  AskFact,
  AskIntent,
  AskLink,
  AskLinkKind,
  AskPendingCommand,
  AskProvenance,
  AskResult,
  AskStatus,
  AskTiming,
  ReadingFreshness,
} from './types'

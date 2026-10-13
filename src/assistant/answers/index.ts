/**
 * 回答模板门面。
 *
 * 模板只负责"把选定对象讲清楚"，不负责挑对象——挑对象（意图、消歧、上下文沿用）在 ask.ts。
 * 这样新增一类问法时，改动只落在模板文件里，不会牵动解析与消歧。
 */
export type { AnswerDraft } from './shared'
export { DEVICE_HEALTH_NOTE, NO_DEVICE_NOTE, dataSourceLabel, draft, provenanceOf } from './shared'

export { answerCampusOverview } from './overview'
export { answerPointStatus, type PointAnswerInput } from './point'
export { answerEventReason, type EventAnswerInput } from './event'
export { MEDIA_BOUNDARIES, answerMediaCompare, type MediaAnswerInput } from './media'
export { QUEUE_LIMIT, answerOpenEvents } from './queue'
export {
  ASK_EXAMPLES,
  answerAmbiguous,
  answerNoObject,
  answerUnknownQuestion,
  answerWriteRequest,
  answerPrepareRedDemo,
} from './fallback'

import type { AskContext, AskIntent } from '../types'
export function featureIntent(question: string, context: AskContext = {}): AskIntent | null {
  if (context.simulation && /改看|只看.*变化/.test(question)) return 'rule_simulate'
  if (context.videoId && /为什么.*(?:比|比较)|为什么不能|播放第/.test(question)) return 'video_compare'
  if (/试算|候选阈值|取消试算|等级变化的记录|为什么这条被排除/.test(question)) return 'rule_simulate'
  if (/回放|回看|升级过程|什么时候.*(?:红|橙)|当时.*(?:依据|记录|阈值)/.test(question) && !/视频|短片/.test(question)) return 'event_replay'
  if (/类似.*(?:问题|案例)|相似.*案例|历史案例|匹配.*条件/.test(question) || context.caseIds?.length && /打开第[一二三四五]|怎么处理/.test(question)) return 'case_search'
  if ((/比较|对比/.test(question) && /测点|读数|B\d/i.test(question) && !/照片|影像|视频|帧/.test(question))
    || context.pointIds?.length && /改看|区间峰值|哪个峰值|哪一个.*高|这两个点.*趋势/.test(question)) return 'point_compare'
  return null
}

import type { AskIntent } from '../types'

/** 专门问题先于“照片 / 校园 / 为什么”等泛词；不执行任何任务。 */
export function specificIntent(text: string): AskIntent | null {
  if (/能帮我|能做什么|有哪些功能|怎么用小瞳|如何使用小瞳/.test(text)) return 'capabilities'
  if (/(怎么|如何).*(上传|载入|准备|导入)/.test(text)) return 'capabilities'
  if (/(替我|帮我|请).*(关闭事件|派工|验收|复查)/.test(text)) return 'demo_guide'
  if (/(处理完|处理完成|谁.*处理|谁.*维修|还缺.*步|验收.*了吗)/.test(text)) return 'demo_guide'
  if (/(趋势|曲线|走势图)/.test(text) && !/(照片|影像|视频)/.test(text)) return 'point_trend'
  if (/(照片|图片|影像|区域)/.test(text) && /(为什么|为何|原因|凭什么)/.test(text)) return 'media_reason'
  if (/(全校|校园|校区|所有|哪些|哪个)/.test(text) && /(异常|未处理|没处理|未关闭)/.test(text)) return 'open_events'
  return null
}

export function existingOnly(text: string): boolean {
  return /不要|别.*(?:补|载|生成)|不(?:用|要).*补|只看|仅看|已有|现有|取消/.test(text)
}

import { normalizeQuestion } from '../parse'
import { existingOnly } from '../query/specific'

export type DirectorIntent = 'video' | 'spatial' | 'start' | 'sampling' | 'media' | 'inspection' | 'handling' | 'receipt' | 'end'

/** 只有明确任务进入功能编排；问“状态/为什么/恢复了吗”绝不误触发。 */
export function directorIntent(question: string): DirectorIntent | null {
  const text = normalizeQuestion(question).compact
  if (['停止自动补齐', '结束本次演示', '退出演示模式', '停止本次演示'].includes(text)) return 'end'
  if (['查看操作记录', '查看任务回执', '演示对账单', '本次演示生成了什么', '本次演示用了哪些数据'].includes(text)) return 'receipt'
  if (existingOnly(text)) return null
  if (/不要|取消|别|为什么|如何|怎么|能否|能不能|可不可以|可以.*吗/.test(text)) return null
  if (/帮我定位|在3d.*定位|定位.*3d|定位(?:这个|该|b\d)|它在哪/.test(text)) return 'spatial'
  if (/视频|关键帧|短片/.test(text) && /播放|回放|分析|提取.*关键帧|对比.*关键帧|演示.*视频/.test(text)) return 'video'
  if (/(分析|对比|比较).*(裂缝照片|裂缝影像|前后照片|照片变化|裂缝变化)/.test(text)) return 'media'
  if (/(准备|补齐|生成).*(采样|监测数据)/.test(text)) return 'sampling'
  if (/(准备|打开).*(巡检任务|巡检待办)/.test(text)) return 'inspection'
  if (!/(带我演示|开始演示|演示一下|演示.*(?:采样|巡检|nfc|影像|照片|裂缝|处置))/.test(text)) return null
  if (/巡检|nfc|读卡|签到/.test(text)) return 'inspection'
  if (/采样|实时数据|趋势/.test(text)) return 'sampling'
  if (/影像|照片|裂缝变化|视觉证据/.test(text)) return 'media'
  if (/处置|处理流程/.test(text)) return 'handling'
  return 'start'
}

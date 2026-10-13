import { normalizeQuestion } from '../parse'
import type { MediaFrameRef } from '@/types/media'
import type { SessionVideo, VideoAnalysis } from '@/types/media/video'

export type VideoFocus = 'playback' | 'keyframes' | 'comparison' | 'relationship' | 'comparability' | 'status'

export const VIDEO_FOCUS_LABEL: Record<VideoFocus, string> = {
  playback: '视频回放', keyframes: '关键帧提取', comparison: '首末帧对比',
  relationship: '视频与传感器关系', comparability: '比对条件核对', status: '视频会话状态',
}

/** 同一视频可以复用证据，但不同问法要回答不同的事项。 */
export function videoFocus(question: string): VideoFocus {
  const text = normalizeQuestion(question).compact
  if (/一致|同步|对应|印证|吻合/.test(text) && /读数|传感器|数据|监测/.test(text)) return 'relationship'
  if (/为什么|为何|能不能|能否|不能|可以比对|可比|比对条件/.test(text)) return 'comparability'
  if (/播放|回放|观看|看看视频/.test(text) && !/对比|比较/.test(text)) return 'playback'
  if (/提取|抽帧/.test(text)) return 'keyframes'
  if (/对比|比较|差异|变化|变了|分析/.test(text)) return 'comparison'
  if (/关键帧|抽帧|提取/.test(text)) return 'keyframes'
  return 'status'
}

/** 追问比较/抽帧沿用当前同点视频，不默默把实拍换成模拟片。 */
export function requestedVideoAsset(question: string, current: SessionVideo | null, pointId: string): 'change' | 'inspection' | 'current' {
  if (/公开|实拍/.test(question)) return 'inspection'
  if (/固定机位|模拟变化|合成变化/.test(question)) return 'change'
  const focus = videoFocus(question)
  if (current?.pointId === pointId && (/这段|这个/.test(question) || focus === 'comparison' || focus === 'keyframes')) {
    return current.assetKey === 'inspection' ? 'inspection' : current.assetKey === 'change' ? 'change' : 'current'
  }
  return 'change'
}

interface VideoFocusInput {
  question: string
  video: SessionVideo
  frames: MediaFrameRef[]
  analysis: VideoAnalysis | null
}

export function videoConclusion(input: VideoFocusInput): string {
  const { video, frames, analysis } = input
  const focus = videoFocus(input.question)
  if (focus === 'relationship') return '不能确认视频变化与传感器读数真实一致或同步：素材仅绑定此测点供演示，画面非本校、真实拍摄时间未知。下方监测读数来自记录，视频像素差异不能换算成毫米。'
  if (focus === 'playback') return `已准备「${video.title}」的 ${video.durationSeconds.toFixed(1)} 秒回放，请点击下方播放器开始播放。${frames.length > 0 ? `已附 ${frames.length} 个关键帧供定位。` : '当前尚未抽取关键帧。'}`
  if (focus === 'keyframes') return frames.length === 0 ? '尚未提取关键帧；可以请求“提取这段视频的关键帧”。'
    : `当前已提取 ${frames.length} 个关键帧，时间码为 ${frames.map(row => row.timeCode?.toFixed(1)).join(' / ')} 秒；点击缩略图可定位原视频。只展示这些采样帧，不是逐帧识别。`
  if (focus === 'comparability') {
    if (!video.comparable || analysis?.reason) return `这段视频不能用于前后差异判定：${analysis?.reason || video.note}缺少固定机位和画面配准依据，不能把镜头变化当作裂缝变化。`
    return analysis === null ? '当前固定机位演示素材具备预设对比条件，但尚未完成分析，暂时没有变化结论。'
      : '当前固定机位演示素材的首末帧已完成预设区域比对，并非“不能比对”；该结论只描述像素差异，不识别裂缝宽度或真实病害。'
  }
  if (focus === 'status') return `当前会话已读取「${video.title}」，时长 ${video.durationSeconds.toFixed(1)} 秒，关键帧 ${frames.length} 个；${analysis === null ? '尚未完成分析' : analysis.reason ? '已核对为不可比对' : '已完成预设区域对比'}。视频只在本次会话中保留。`
  if (!analysis) return '尚未完成首末帧分析，不能给出差异结论；可以请求“分析这段视频”。'
  if (analysis.reason) return `首末帧无法用于变化判断：${analysis.reason}`
  const crack = analysis.regions.crack
  const control = analysis.regions.control
  return `视频首末关键帧：${(crack?.summary ?? '裂缝区域尚无计算结果').replace(/\*\*/g, '').replace(/[。；;]+$/, '')}；${control ? `完好墙面差异 ${(control.changedRatio * 100).toFixed(1)}%` : '完好墙面尚无计算结果'}。`
}

import { draft, type AnswerDraft } from '../answers/shared'
import { answerPointStatus } from '../answers/point'
import { buildLink, buildSpatialLink } from '../actions'
import type { AssistantSnapshot } from '../selectors'
import type { PointRef } from '../resolve'
import { VIDEO_BOUNDARY } from '@/config/media/demoVideos'
import { videoConclusion, videoFocus, VIDEO_FOCUS_LABEL } from './focus'

/** 普通问答只读已经完成的分析；绝不借提问补视频、抽帧或生成采样。 */
export function answerVideo(snapshot: AssistantSnapshot, point: PointRef, question = ''): AnswerDraft {
  const video = snapshot.media.video
  if (!video || video.pointId !== point.id) return draft(`${point.code} 当前没有已读取的会话视频。`, {
    status: 'not_found', pointId: point.id,
    gaps: [`请先在设置页唯一全链入口准备，再说“播放 ${point.code} 的演示巡检视频”。`],
    links: [buildLink('settings'), buildLink('media_page', point.id)], dataNotes: [VIDEO_BOUNDARY],
  })
  const frames = snapshot.media.frames.filter((row) => row.videoId === video.id && row.pointId === point.id)
    .sort((a, b) => (a.timeCode ?? 0) - (b.timeCode ?? 0))
  const saved = snapshot.media.videoAnalysis
  const analysis = saved?.videoId === video.id && saved.pointId === point.id && saved.frameIds.every((id) => frames.some((row) => row.id === id)) ? saved : null
  const reading = answerPointStatus({ snapshot, point, matchNote: '同一视频关联测点' })
  const conclusion = videoConclusion({ question, video, frames, analysis })
  const keyframe = /第([一二三123])个.*关键帧/.exec(question)?.[1]
  const index = keyframe ? '一二三'.includes(keyframe) ? '一二三'.indexOf(keyframe) : Number(keyframe)-1 : -1
  const seekTime = frames[index]?.timeCode ?? undefined
  return draft(`${point.code}：${seekTime !== undefined ? `定位第 ${index+1} 个关键帧（${seekTime.toFixed(1)} 秒），在下方播放器播放。` : conclusion}`, {
    pointId: point.id,
    context: { pointId: point.id, videoId: video.id },
    facts: [
      { label: '本次回答重点', value: VIDEO_FOCUS_LABEL[videoFocus(question)], unit: '' },
      { label: '视频', value: video.title, unit: '' },
      { label: '时长', value: video.durationSeconds.toFixed(1), unit: '秒' },
      { label: '关键帧时间码', value: frames.map((row) => row.timeCode?.toFixed(1)).join(' / ') || '尚未抽取', unit: '秒' },
      { label: '影像与数据关系', value: '素材绑定此测点供演示；画面非本校，同步拍摄时间未知，不能确认真实时序一致。', unit: '' },
      ...(reading.facts ?? []).filter((row) => !row.label.includes('定位')),
    ],
    timing: reading.timing, provenance: reading.provenance, evidence: reading.evidence,
    previews: [{ kind: 'video_evidence', video, analysis, frameIds: frames.map((row) => row.id), seekTime, autoplay: seekTime !== undefined }, ...(reading.previews ?? [])],
    followups: ['播放第二个关键帧','为什么不能比较？'],
    gaps: !analysis ? ['尚无分析结论，请明确请求演示视频抽帧。'] : analysis.reason ? ['机位或配准不满足前后比较条件；不输出变化比例。'] : [],
    links: [buildLink('media_page', point.id), buildSpatialLink({ pointId: point.id, buildingId: point.buildingId, floorId: point.floorId }), ...(reading.links ?? []).filter((row) => row.kind === 'event_detail')],
    dataNotes: [video.source, video.note, VIDEO_BOUNDARY, '毫米数仅来自监测记录；视频差异不是裂缝宽度，预设素材不证明传感器与影像同步采集。'],
  })
}
